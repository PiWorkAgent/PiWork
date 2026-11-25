import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui-store';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { classifyStreamError, cleanStreamError } from '@/lib/stream-error';

/**
 * A failed run, as a message in the transcript.
 *
 * It used to be a banner pinned above the list, which read as chrome rather
 * than as part of the conversation — and its one control was Retry, useless
 * for the failure that actually stops people: no model is configured, so every
 * retry fails the same way. The card sits where the reply would have been and
 * opens 设置 → 模型 when clicked, which is the fix for that case; Retry is kept
 * for the failures a second attempt can survive.
 */
export function StreamErrorMessage({
  error,
  onRetry,
  busy = false,
  draftRestored = false,
}: {
  error: string;
  /** Re-run the failed turn; omitted when there is nothing stored to replay. */
  onRetry?: () => void;
  /**
   * The run is still alive: the agent reports each failed attempt as it
   * happens and then retries it with backoff. Offering 重试 here would start a
   * second turn on top of the first, so the card says it is retrying instead.
   */
  busy?: boolean;
  /**
   * This send never reached the conversation, so its text went back into the
   * composer — where the reader can edit it or press Enter.
   */
  draftRestored?: boolean;
}) {
  const { t } = useI18n();
  const openSettings = useUIStore((s) => s.openSettings);
  const openModels = () => openSettings('models');
  const configuration = classifyStreamError(error) === 'configuration';

  return (
    <div className="flex w-full px-4 py-2" data-testid="stream-error-message">
      {/* A div, not a button: the two controls inside are real buttons, and a
          card wrapped in one would be interactive content nested in
          interactive content. Clicking the card is a mouse shortcut; the
          `设置 → 模型` button is the keyboard path. */}
      <div
        onClick={openModels}
        className={cn(
          'group flex w-full max-w-[85%] cursor-pointer flex-col gap-2.5 rounded-xl border px-4 py-3',
          'border-destructive/30 bg-destructive/[0.06] transition-colors hover:border-destructive/50 hover:bg-destructive/10',
        )}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-destructive">
              {configuration ? t('还没有配置模型') : t('本轮对话失败')}
            </div>
            <p
              className={cn(
                'mt-1 text-sm leading-relaxed break-words',
                configuration ? 'text-muted-foreground' : 'text-destructive/80',
                !configuration && 'line-clamp-4',
              )}
              title={configuration ? undefined : cleanStreamError(error)}
            >
              {configuration
                ? t('当前模型没有可用的 API Key。打开 设置 → 模型，登录服务商或填写 API Key 后即可继续。')
                : cleanStreamError(error)}
            </p>
            {draftRestored && (
              <p className="mt-1 text-xs text-muted-foreground/80">
                {t('这条消息没有发出去，已放回输入框。')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 pl-9">
          {busy ? (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('正在重试…')}
            </span>
          ) : (
            onRetry && (
              <Button
                size="sm"
                variant="outline"
                className="mr-auto h-7 gap-1.5 border-destructive/25 bg-transparent px-2 text-xs hover:bg-destructive/10"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetry();
                }}
              >
                <RefreshCw className="h-3 w-3" />
                {t('重试')}
              </Button>
            )
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openModels();
            }}
            aria-label={t('打开模型设置')}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground',
              'transition-colors hover:bg-destructive/10 hover:text-destructive',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {t('设置 → 模型')}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
