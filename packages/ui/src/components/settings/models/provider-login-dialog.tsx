import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import type {
  AuthLoginEvent,
  AuthMethodType,
  AuthNotice,
  AuthPromptSpec,
  ProviderAuthRow,
} from '@pi/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSDK } from '@/hooks/use-sdk';
import { useI18n } from '@/i18n';
import {
  AUTH_PROVIDERS_QUERY_KEY,
  copyText,
  openAuthUrl,
  subscribeAuthEvents,
} from '@/lib/auth-client';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

interface ProviderLoginDialogProps {
  provider: ProviderAuthRow | null;
  onClose: () => void;
}

type Phase =
  | { kind: 'choose' }
  /** Flow registered, nothing to ask yet (browser hop, device polling…). */
  | { kind: 'waiting' }
  | { kind: 'prompt'; requestId: string; prompt: AuthPromptSpec }
  | { kind: 'error'; message: string }
  | { kind: 'done'; warning?: string };

/**
 * Drives one SDK login flow.
 *
 * The SDK asks for API keys and OAuth methods with a stream of prompts
 * (`text`/`secret`/`manual_code`/`select`) and notices (`auth_url`,
 * `device_code`, `progress`, `info`); this dialog is the generic renderer for
 * all of them, so a new provider in the SDK needs no UI work. It never talks
 * to auth.json or the network itself — main owns the flow, and events are
 * keyed by the loginId generated here.
 */
export function ProviderLoginDialog({ provider, onClose }: ProviderLoginDialogProps) {
  const { t } = useI18n();
  const sdk = useSDK();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [methodType, setMethodType] = useState<AuthMethodType | null>(null);
  const [notices, setNotices] = useState<AuthNotice[]>([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const loginIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const autoOpenedRef = useRef(new Set<string>());
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    loginIdRef.current = null;
    finishedRef.current = false;
    autoOpenedRef.current = new Set();
    setPhase({ kind: 'choose' });
    setMethodType(null);
    setNotices([]);
    setValue('');
    setBusy(false);
  }, []);

  const invalidateModels = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['models'] });
    void queryClient.invalidateQueries({ queryKey: ['config'] });
  }, [queryClient]);

  const handleEvent = useCallback(
    (event: AuthLoginEvent) => {
      if (event.type === 'changed') {
        void queryClient.invalidateQueries({ queryKey: AUTH_PROVIDERS_QUERY_KEY });
        return;
      }
      if (event.type === 'prompt') {
        setPhase({ kind: 'prompt', requestId: event.requestId, prompt: event.prompt });
        setValue('');
        setBusy(false);
        return;
      }
      if (event.type === 'prompt_closed') {
        // Only clear the matching step: an older prompt (the manual-code half
        // of an OAuth race) may close while a newer one is already showing.
        setPhase((current) =>
          current.kind === 'prompt' && current.requestId === event.requestId
            ? { kind: 'waiting' }
            : current,
        );
        return;
      }
      if (event.type === 'notice') {
        setNotices((prev) => {
          const next = [...prev];
          // `progress` supersedes the previous progress line instead of
          // stacking up "Exchanging…" messages.
          const lastProgress = next.map((n) => n.type).lastIndexOf('progress');
          if (event.event.type === 'progress' && lastProgress !== -1) {
            next[lastProgress] = event.event;
          } else {
            next.push(event.event);
          }
          return next.slice(-6);
        });
        if (event.event.type === 'auth_url') {
          // Opening the browser is the expected next step (the CLI does it
          // too); the URL stays on screen for a manual retry or copy.
          if (!autoOpenedRef.current.has(event.event.url)) {
            autoOpenedRef.current.add(event.event.url);
            openAuthUrl(event.event.url);
          }
        }
        return;
      }
      if (event.type === 'catalog') {
        invalidateModels();
        return;
      }
      // settled
      finishedRef.current = true;
      loginIdRef.current = null;
      if (event.ok) {
        invalidateModels();
        void queryClient.invalidateQueries({ queryKey: AUTH_PROVIDERS_QUERY_KEY });
        setPhase({ kind: 'done', warning: event.credentialSaved ? event.error : undefined });
        toast(
          event.credentialSaved
            ? t('已登录 {name}（模型列表同步失败，稍后自动补齐）', { name: provider?.name ?? '' })
            : t('已登录 {name}', { name: provider?.name ?? '' }),
        );
        closeTimerRef.current = setTimeout(onClose, 900);
        return;
      }
      if (event.cancelled) {
        onClose();
        return;
      }
      setPhase({ kind: 'error', message: event.error ?? t('未知错误') });
      setBusy(false);
    },
    [invalidateModels, onClose, provider?.name, queryClient, t],
  );

  // A fresh dialog for a fresh provider: the component stays mounted between
  // opens, so without this the previous provider's notices (a device code, an
  // error) would greet the next one.
  useEffect(() => {
    if (provider) reset();
  }, [provider?.id, reset]);

  // One subscription per open dialog; the loginId is generated when the user
  // picks a method, so the filter is read at event time, not captured here.
  useEffect(() => {
    if (!provider) return;
    return subscribeAuthEvents((event) => {
      if (event.type !== 'changed' && event.loginId !== loginIdRef.current) return;
      handleEvent(event);
    });
  }, [provider, handleEvent]);

  // A dialog torn down mid-flow must not leave the main process waiting on a
  // prompt nobody can answer.
  useEffect(() => {
    if (!provider) return;
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      const loginId = loginIdRef.current;
      if (loginId && !finishedRef.current) void sdk.auth.cancelLogin(loginId).catch(() => {});
    };
    // sdk is stable for the app lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    if (phase.kind === 'prompt' && phase.prompt.type !== 'select') inputRef.current?.focus();
  }, [phase]);

  const start = async (type: AuthMethodType) => {
    if (!provider) return;
    const loginId = crypto.randomUUID();
    loginIdRef.current = loginId;
    finishedRef.current = false;
    setMethodType(type);
    setNotices([]);
    setPhase({ kind: 'waiting' });
    setBusy(true);
    try {
      await sdk.auth.login({ loginId, providerId: provider.id, type });
    } catch (error) {
      loginIdRef.current = null;
      setBusy(false);
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const answer = async (answerValue: string) => {
    const loginId = loginIdRef.current;
    if (!loginId || phase.kind !== 'prompt') return;
    setBusy(true);
    try {
      await sdk.auth.respond({ loginId, requestId: phase.requestId, value: answerValue });
      setPhase({ kind: 'waiting' });
      setValue('');
    } catch (error) {
      setBusy(false);
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const cancel = () => {
    const loginId = loginIdRef.current;
    if (loginId && !finishedRef.current) void sdk.auth.cancelLogin(loginId).catch(() => {});
    onClose();
  };

  if (!provider) return null;

  const interactiveMethods = provider.methods.filter((method) => method.interactive);
  const currentMethod = provider.methods.find((method) => method.type === methodType);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent className="max-w-md" data-testid="provider-login-dialog">
        <DialogHeader>
          <DialogTitle>{t('登录 {name}', { name: provider.name })}</DialogTitle>
          <DialogDescription>
            {phase.kind === 'choose'
              ? t('选择登录方式。')
              : (currentMethod?.label ?? t('正在登录…'))}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {phase.kind === 'choose' && (
            <div className="space-y-2">
              {interactiveMethods.map((method) => (
                <button
                  key={method.type}
                  type="button"
                  onClick={() => void start(method.type)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors',
                    'hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {method.type === 'oauth'
                        ? method.subscription
                          ? t('使用订阅登录')
                          : t('使用 OAuth 登录')
                        : t('使用 API Key')}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {method.label}
                    </span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              {interactiveMethods.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('这个服务商使用云环境凭据，无法在这里登录。')}
                </p>
              )}
            </div>
          )}

          {(phase.kind === 'waiting' || phase.kind === 'prompt') && (
            <>
              {notices.map((notice, index) => (
                <NoticeCard key={index} notice={notice} />
              ))}

              {phase.kind === 'waiting' && !notices.some((n) => n.type === 'device_code') && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('等待完成授权…')}
                </div>
              )}

              {phase.kind === 'prompt' && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                  <p className="text-xs leading-relaxed">{phase.prompt.message}</p>
                  {phase.prompt.type === 'select' ? (
                    <div className="space-y-1">
                      {phase.prompt.options.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          disabled={busy}
                          onClick={() => void answer(option.id)}
                          className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="text-sm">{option.label}</span>
                          {option.description && (
                            <span className="text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        // Text prompts may legitimately accept an empty answer
                        // (GitHub Copilot: blank means github.com); a secret may not.
                        if (phase.prompt.type === 'secret' && !value.trim()) return;
                        void answer(value);
                      }}
                    >
                      <Input
                        ref={inputRef}
                        type={phase.prompt.type === 'secret' ? 'password' : 'text'}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={'placeholder' in phase.prompt ? (phase.prompt.placeholder ?? '') : ''}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-8 flex-1"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || (phase.prompt.type === 'secret' && !value.trim())}
                      >
                        {t('继续')}
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </>
          )}

          {phase.kind === 'error' && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">
                {t('登录失败：{message}', { message: phase.message })}
              </span>
            </div>
          )}

          {phase.kind === 'done' && (
            <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                {t('登录成功。')}
                {phase.warning && (
                  <span className="mt-1 block text-muted-foreground">
                    {t('凭据已保存，但模型列表同步失败；稍后会自动补齐。')}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          {phase.kind === 'error' ? (
            <Button variant="outline" size="sm" onClick={() => reset()}>
              {t('重试')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={cancel}>
              {t('取消')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Renders one SDK notice. URLs/codes get actions; text is inline. */
function NoticeCard({ notice }: { notice: AuthNotice }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (notice.type === 'auth_url') {
    return (
      <div className="rounded-md border p-3 text-xs">
        <p className="text-muted-foreground">{notice.instructions ?? t('在浏览器中完成授权后回到这里。')}</p>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs" onClick={() => openAuthUrl(notice.url)}>
            <ExternalLink className="mr-1 h-3 w-3" />
            {t('打开浏览器')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => void copyText(notice.url)}
          >
            <Copy className="mr-1 h-3 w-3" />
            {t('复制链接')}
          </Button>
        </div>
      </div>
    );
  }

  if (notice.type === 'device_code') {
    return (
      <div className="rounded-md border p-3 text-xs">
        <p className="text-muted-foreground">{t('在浏览器中打开验证页面，输入下面的代码：')}</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm tracking-widest">
            {notice.userCode}
          </code>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              void copyText(notice.userCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
            {copied ? t('已复制') : t('复制代码')}
          </Button>
        </div>
        <div className="mt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => openAuthUrl(notice.verificationUri)}
          >
            <ExternalLink className="mr-1 h-3 w-3" />
            {t('打开验证页面')}
          </Button>
        </div>
      </div>
    );
  }

  if (notice.type === 'info') {
    return (
      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        <p>{notice.message}</p>
        {notice.links?.map((link) => (
          <button
            key={link.url}
            type="button"
            className="mt-1 block text-foreground underline"
            onClick={() => openAuthUrl(link.url)}
          >
            {link.label ?? link.url}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {notice.message}
    </div>
  );
}
