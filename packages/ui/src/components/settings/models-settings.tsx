import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProviderAuthRow } from '@pi/types';
import { AlertCircle, EyeIcon, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useSDK } from '@/hooks/use-sdk';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ErrorState } from '@/components/common/error-state';
import { cn } from '@/lib/utils';
import { useAuthProvidersQuery, hasAuthApi, AUTH_PROVIDERS_QUERY_KEY } from '@/lib/auth-client';
import { toast } from '@/stores/toast-store';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  ProviderEntry,
  ProviderModelInfo,
  ProviderModelListErrorCode,
  ModelEntry,
} from '@pi/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BuiltinProvidersSection } from './models/builtin-providers-section';
import { CustomProvidersSection } from './models/custom-providers-section';
import { ProviderLoginDialog } from './models/provider-login-dialog';

const DEFAULT_PROVIDER: ProviderEntry = {
  baseUrl: 'https://api.example.com/v1',
  api: 'openai-completions',
  apiKey: '',
  compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  models: [],
};

/**
 * The API families `@earendil-works/pi-ai` registers — its `KnownApi` union.
 * A typo here only shows up as a failed request, so the common cases are a
 * list, not a text field. `Api` is deliberately open (`KnownApi | string`),
 * hence the Custom escape hatch for extension-provided protocols.
 */
const API_TYPES: { value: string; label: string }[] = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses' },
  { value: 'openai-codex-responses', label: 'OpenAI Codex Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'google-vertex', label: 'Google Vertex AI' },
  { value: 'mistral-conversations', label: 'Mistral Conversations' },
  { value: 'bedrock-converse-stream', label: 'Amazon Bedrock Converse' },
];
const CUSTOM_API = '__custom__';

const DEFAULT_MODEL: ModelEntry = {
  id: '',
  name: '',
  input: ['text'],
};

/** Determine model input type: text-only language model or multimodal vision model */
function getModelInputType(model: ModelEntry): 'text' | 'multimodal' {
  const input = model.input ?? [];
  if (input.includes('image')) return 'multimodal';
  return 'text';
}

/**
 * 模型 — providers and the models they make available.
 *
 * Two halves, deliberately separated by a rule:
 *
 *  1. 内置服务商: everything the Pi SDK ships. Sign-in is subscription OAuth or
 *     API key; the credential goes to `~/.pi/agent/auth.json`, managed by the
 *     SDK. Nothing here edits a file.
 *  2. 自定义服务商: `~/.pi/agent/models.json` — endpoints Pi does not ship.
 *
 * The models both halves make usable all flow into one picker (see
 * `config.listModels()`).
 */
export function ModelsSettingsPage() {
  const sdk = useSDK();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  // Login / logout for a built-in provider, and models.json delete confirms.
  const [loginProvider, setLoginProvider] = useState<ProviderAuthRow | null>(null);
  const [logoutProvider, setLogoutProvider] = useState<ProviderAuthRow | null>(null);
  const [deleteProvider, setDeleteProvider] = useState<string | null>(null);
  const [deleteModel, setDeleteModel] = useState<{ provider: string; modelId: string } | null>(null);

  // Add/Edit provider dialog
  const [providerDialog, setProviderDialog] = useState<{
    open: boolean;
    editMode: boolean;
    /** The map key being edited; null-equivalent '' when adding. */
    originalName: string;
    name: string;
    data: ProviderEntry;
  }>({ open: false, editMode: false, originalName: '', name: '', data: { ...DEFAULT_PROVIDER } });

  // Provider-advertised models for the add/edit-model dialog. `models: null`
  // means "not fetched (yet)", which is distinct from a successful empty list.
  const [remote, setRemote] = useState<{
    loading: boolean;
    models: ProviderModelInfo[] | null;
    error: { code?: ProviderModelListErrorCode; message: string } | null;
  }>({ loading: false, models: null, error: null });
  const [remoteQuery, setRemoteQuery] = useState('');
  const remoteRequestRef = useRef(0);

  // Add/Edit model dialog
  const [modelDialog, setModelDialog] = useState<{
    open: boolean;
    providerName: string;
    editMode: boolean;
    originalId: string;
    data: ModelEntry;
  }>({ open: false, providerName: '', editMode: false, originalId: '', data: { ...DEFAULT_MODEL } });

  const {
    data: config,
    isLoading,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ['modelsConfig'],
    queryFn: () => sdk.config.getModelsConfig(),
  });

  // Built-in ids feed the "覆盖内置服务商" badge on custom entries. The list is
  // shared with the section above, so it costs nothing extra.
  const { data: authRows } = useAuthProvidersQuery();
  const builtinIds = useMemo(
    () => new Set((authRows ?? []).filter((row) => !row.custom).map((row) => row.id)),
    [authRows],
  );

  const providers = config?.providers ?? {};
  const apiIsKnown = API_TYPES.some((opt) => opt.value === providerDialog.data.api);

  const loadRemoteModels = useCallback(
    async (providerName: string) => {
      const provider = providers[providerName];
      const requestId = ++remoteRequestRef.current;
      setRemoteQuery('');
      if (!provider || !provider.baseUrl.trim() || !provider.apiKey.trim()) {
        setRemote({
          loading: false,
          models: null,
          error: { code: 'invalid', message: '' },
        });
        return;
      }
      setRemote({ loading: true, models: null, error: null });
      const result = await sdk.config.listRemoteModels({
        baseUrl: provider.baseUrl,
        api: provider.api,
        apiKey: provider.apiKey,
      });
      // A newer dialog (or provider) won while this request was in flight.
      if (requestId !== remoteRequestRef.current) return;
      setRemote(
        result.ok
          ? { loading: false, models: result.models ?? [], error: null }
          : {
              loading: false,
              models: null,
              error: { code: result.code, message: result.error ?? '' },
            },
      );
    },
    [providers, sdk],
  );

  const toggleKeyVisibility = useCallback((name: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  /** Everything that reads the provider/model set after a write. */
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['modelsConfig'] });
    queryClient.invalidateQueries({ queryKey: ['models'] });
    queryClient.invalidateQueries({ queryKey: ['config'] });
    queryClient.invalidateQueries({ queryKey: AUTH_PROVIDERS_QUERY_KEY });
  }, [queryClient]);

  // --- Provider operations ---

  const handleAddProvider = useCallback(() => {
    setError(null);
    setProviderDialog({
      open: true,
      editMode: false,
      originalName: '',
      name: '',
      data: { ...DEFAULT_PROVIDER },
    });
  }, []);

  const handleEditProvider = useCallback(
    (name: string) => {
      const p = providers[name];
      if (!p) return;
      setError(null);
      setProviderDialog({
        open: true,
        editMode: true,
        originalName: name,
        name,
        data: { ...p, models: [...p.models], compat: { ...p.compat } },
      });
    },
    [providers],
  );

  const handleSaveProvider = useCallback(async () => {
    try {
      setError(null);
      const { editMode, originalName, name, data } = providerDialog;
      const nextName = name.trim();
      if (!nextName || !data.baseUrl.trim() || !data.api.trim() || !data.apiKey.trim()) {
        setError(t('请填写名称、Base URL、接口类型和 API Key'));
        return;
      }
      const renaming = editMode && nextName !== originalName;
      // Catch the collision here so the message is translated and actionable;
      // the backend validates it again for callers that skip this dialog.
      if ((renaming || !editMode) && providers[nextName]) {
        setError(t('已存在同名服务商'));
        return;
      }
      await sdk.config.saveProvider(editMode ? originalName : null, nextName, data);
      setProviderDialog({ open: false, editMode: false, originalName: '', name: '', data: { ...DEFAULT_PROVIDER } });
      invalidateAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('保存失败'));
    }
  }, [providerDialog, providers, sdk, invalidateAll, t]);

  const handleConfirmDeleteProvider = useCallback(async () => {
    if (!deleteProvider) return;
    try {
      await sdk.config.deleteProvider(deleteProvider);
      setDeleteProvider(null);
      invalidateAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('删除失败'));
    }
  }, [deleteProvider, sdk, invalidateAll, t]);

  // --- Model operations ---

  const handleAddModel = useCallback(
    (providerName: string) => {
      setError(null);
      setModelDialog({
        open: true,
        providerName,
        editMode: false,
        originalId: '',
        data: { ...DEFAULT_MODEL },
      });
      void loadRemoteModels(providerName);
    },
    [loadRemoteModels],
  );

  const handleEditModel = useCallback(
    (providerName: string, model: ModelEntry) => {
      setError(null);
      setModelDialog({
        open: true,
        providerName,
        editMode: true,
        originalId: model.id,
        data: { ...model },
      });
      void loadRemoteModels(providerName);
    },
    [loadRemoteModels],
  );

  const handleSaveModel = useCallback(async () => {
    try {
      setError(null);
      const { providerName, editMode, originalId, data } = modelDialog;
      if (!data.id.trim() || !data.name.trim()) {
        setError(t('请填写模型 ID 和名称'));
        return;
      }
      if (editMode) {
        await sdk.config.updateModel(providerName, originalId, data);
      } else {
        await sdk.config.addModel(providerName, data);
      }
      setModelDialog({ open: false, providerName: '', editMode: false, originalId: '', data: { ...DEFAULT_MODEL } });
      invalidateAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('保存失败'));
    }
  }, [modelDialog, sdk, invalidateAll, t]);

  const handleConfirmDeleteModel = useCallback(async () => {
    if (!deleteModel) return;
    try {
      await sdk.config.deleteModel(deleteModel.provider, deleteModel.modelId);
      setDeleteModel(null);
      invalidateAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('删除失败'));
    }
  }, [deleteModel, sdk, invalidateAll, t]);

  // --- Built-in provider sign-in ---

  // Stable identity: the login dialog re-subscribes to auth events whenever
  // its callbacks change, and an inline arrow would churn that subscription on
  // every render of this page.
  const closeLoginDialog = useCallback(() => {
    setLoginProvider(null);
    void queryClient.invalidateQueries({ queryKey: AUTH_PROVIDERS_QUERY_KEY });
  }, [queryClient]);

  const handleConfirmLogout = useCallback(async () => {
    if (!logoutProvider) return;
    const provider = logoutProvider;
    try {
      await sdk.auth.logout(provider.id);
      setLogoutProvider(null);
      toast(t('已登出 {name}', { name: provider.name }));
      invalidateAll();
    } catch (e) {
      setLogoutProvider(null);
      toast(
        t('登出失败：{message}', { message: e instanceof Error ? e.message : String(e) }),
        'error',
      );
    }
  }, [logoutProvider, sdk, invalidateAll, t]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState
          title={t('读取模型配置失败')}
          description={loadError instanceof Error ? loadError.message : t('未知错误')}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const remoteProvider = providers[modelDialog.providerName];
  const remoteModels = remote.models ?? [];
  const remoteNeedle = remoteQuery.trim().toLowerCase();
  const remoteVisible = remoteNeedle
    ? remoteModels.filter(
        (m) =>
          m.id.toLowerCase().includes(remoteNeedle) ||
          (m.name ?? '').toLowerCase().includes(remoteNeedle),
      )
    : remoteModels;
  const remoteErrorText = (() => {
    const failure = remote.error;
    if (!failure) return null;
    switch (failure.code) {
      case 'unsupported':
        return t('该接口类型不支持自动获取模型列表。');
      case 'unauthorized':
        return t('API Key 无效或无权限（401/403）。');
      case 'invalid':
        return t('请先填写 Base URL 和 API Key 后再获取模型列表。');
      case 'network':
        return t('无法连接服务商：{message}', { message: failure.message });
      case 'http':
        return t('服务商返回错误：{message}', { message: failure.message });
      default:
        return failure.message;
    }
  })();
  const pickRemoteModel = (model: ProviderModelInfo) => {
    setModelDialog((d) => ({
      ...d,
      data: {
        ...d.data,
        id: model.id,
        name: model.name && model.name !== model.id ? model.name : model.id,
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
        ...(model.input?.length ? { input: model.input } : {}),
      },
    }));
    setRemoteQuery('');
  };

  const builtinSection = hasAuthApi() ? (
    <BuiltinProvidersSection onConnect={setLoginProvider} onLogout={setLogoutProvider} />
  ) : (
    <p className="rounded-lg border px-3 py-6 text-center text-xs text-muted-foreground">
      {t('内置服务商登录仅在桌面应用中可用。')}
    </p>
  );

  const customSection = (
    <CustomProvidersSection
      providers={providers}
      builtinIds={builtinIds}
      visibleKeys={visibleKeys}
      onToggleKey={toggleKeyVisibility}
      onAddProvider={handleAddProvider}
      onEditProvider={handleEditProvider}
      onDeleteProvider={setDeleteProvider}
      onAddModel={handleAddModel}
      onEditModel={handleEditModel}
      onDeleteModel={(provider, modelId) => setDeleteModel({ provider, modelId })}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <div className="mx-6 mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-6 shrink-0 px-2" onClick={() => setError(null)}>
            &times;
          </Button>
        </div>
      )}

      {/* Constrains Radix's max-content table wrapper — otherwise a long
          provider URL or API key widens the page instead of wrapping.
          `!important` is required: Radix sets `display: table` as an inline
          style, which a plain class rule cannot override. */}
      <ScrollArea className="flex-1 px-6 py-4" viewportClassName="[&>div]:!block [&>div]:!min-w-0">
        {/* Custom providers always lead. They are the user's own setup — not
            catalog entries — and the section stays short: at most a few cards
            when configured, one muted line when not. Keeping the position
            fixed means "my providers" is always in the same place. */}
        {customSection}
        <Separator className="my-5" />
        {builtinSection}

        <p className="pb-2 pt-4 text-[0.6875rem] text-muted-foreground/70">
          {t('内置服务商的登录凭据保存在 ~/.pi/agent/auth.json；自定义配置保存在 ~/.pi/agent/models.json。')}
        </p>
      </ScrollArea>

      {/* Built-in provider sign-in */}
      <ProviderLoginDialog provider={loginProvider} onClose={closeLoginDialog} />

      <AlertDialog
        open={!!logoutProvider}
        onOpenChange={(open: boolean) => !open && setLogoutProvider(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('登出服务商？')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('确定登出「{name}」吗？登出后需要重新登录才能使用它的模型。', {
                name: logoutProvider?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLogout}>{t('登出')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Provider dialog */}
      <Dialog open={providerDialog.open} onOpenChange={(open) => !open && setProviderDialog({ open: false, editMode: false, originalName: '', name: '', data: { ...DEFAULT_PROVIDER } })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{providerDialog.editMode ? t('编辑服务商') : t('添加服务商')}</DialogTitle>
            <DialogDescription>
              {providerDialog.editMode
                ? t('修改 {name} 的配置', {
                    name: providerDialog.name.trim() || providerDialog.originalName,
                  })
                : t('添加一个新的模型服务商')}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          )}
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="providerName">{t('名称 *')}</Label>
              <Input
                id="providerName"
                placeholder="e.g. minimax, openai, dashscope"
                value={providerDialog.name}
                onChange={(e) => setProviderDialog((d) => ({ ...d, name: e.target.value }))}
              />
              {providerDialog.editMode && (
                <p className="mt-1 text-[0.625rem] text-muted-foreground">
                  {t('改名会一并移动该服务商下的所有模型配置。')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="providerBaseUrl">Base URL *</Label>
              <Input
                id="providerBaseUrl"
                placeholder="https://api.example.com/v1"
                value={providerDialog.data.baseUrl}
                onChange={(e) => setProviderDialog((d) => ({ ...d, data: { ...d.data, baseUrl: e.target.value } }))}
              />
            </div>
            <div>
              <Label htmlFor="providerApi">{t('接口类型 *')}</Label>
              <Select
                value={apiIsKnown ? providerDialog.data.api : CUSTOM_API}
                onValueChange={(value: string) =>
                  setProviderDialog((d) => ({
                    ...d,
                    data: { ...d.data, api: value === CUSTOM_API ? '' : value },
                  }))
                }
              >
                <SelectTrigger id="providerApi">
                  <SelectValue>
                    {apiIsKnown ? (
                      <span className="font-mono text-xs">{providerDialog.data.api}</span>
                    ) : (
                      t('自定义…')
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {API_TYPES.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        <span>{opt.label}</span>
                        <span className="text-[0.625rem] text-muted-foreground">{opt.value}</span>
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_API}>{t('自定义…')}</SelectItem>
                </SelectContent>
              </Select>
              {!apiIsKnown && (
                <Input
                  id="providerApiCustom"
                  className="mt-2"
                  aria-label={t('接口类型')}
                  placeholder={t('例如 openai-completions')}
                  value={providerDialog.data.api}
                  onChange={(e) =>
                    setProviderDialog((d) => ({ ...d, data: { ...d.data, api: e.target.value } }))
                  }
                />
              )}
              <p className="mt-1 text-[0.625rem] text-muted-foreground">
                {t('选列表里的标准接口；第三方扩展可选「自定义…」直接填。')}
              </p>
            </div>
            <div>
              <Label htmlFor="providerApiKey">API Key *</Label>
              <Input
                id="providerApiKey"
                type="password"
                placeholder="sk-..."
                value={providerDialog.data.apiKey}
                onChange={(e) => setProviderDialog((d) => ({ ...d, data: { ...d.data, apiKey: e.target.value } }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProviderDialog({ open: false, editMode: false, originalName: '', name: '', data: { ...DEFAULT_PROVIDER } })}>
              {t('取消')}
            </Button>
            <Button onClick={handleSaveProvider}>{t('保存')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Model dialog */}
      <Dialog open={modelDialog.open} onOpenChange={(open) => !open && setModelDialog({ open: false, providerName: '', editMode: false, originalId: '', data: { ...DEFAULT_MODEL } })}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{modelDialog.editMode ? t('编辑模型') : t('添加模型')}</DialogTitle>
            <DialogDescription>
              {t('服务商：{name}', { name: modelDialog.providerName })}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          )}

          {/* What the provider says it serves. Fetched on open, refreshable;
              a failure leaves the manual fields below fully usable. */}
          <div className="rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium">{t('可用模型')}</div>
                <div className="text-[0.625rem] text-muted-foreground">
                  {t('从服务商拉取；点击填入下方字段。')}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                disabled={remote.loading}
                onClick={() => void loadRemoteModels(modelDialog.providerName)}
              >
                {remote.loading ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                {remote.loading ? t('获取中…') : t('刷新')}
              </Button>
            </div>

            {remoteErrorText && (
              <p className="mt-2 text-[0.6875rem] leading-relaxed text-destructive">{remoteErrorText}</p>
            )}

            {!remote.loading && remote.models && remote.models.length === 0 && (
              <p className="mt-2 text-[0.6875rem] text-muted-foreground">
                {t('没有从服务商获取到模型。')}
              </p>
            )}

            {remoteModels.length > 0 && (
              <>
                <Input
                  value={remoteQuery}
                  onChange={(e) => setRemoteQuery(e.target.value)}
                  placeholder={t('筛选模型…')}
                  aria-label={t('筛选模型')}
                  className="mt-2 h-7 text-xs"
                />
                <div className="mt-1.5 max-h-40 overflow-y-auto rounded-md border bg-background">
                  {remoteVisible.map((model) => {
                    const isCurrent =
                      modelDialog.editMode && model.id === modelDialog.originalId;
                    const isAdded =
                      !isCurrent && (remoteProvider?.models ?? []).some((m) => m.id === model.id);
                    return (
                      <button
                        key={model.id}
                        type="button"
                        disabled={isAdded}
                        onClick={() => pickRemoteModel(model)}
                        className={cn(
                          'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors',
                          isAdded ? 'cursor-default opacity-60' : 'hover:bg-accent',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {model.name ?? model.id}
                        </span>
                        {model.name && model.name !== model.id && (
                          <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                            {model.id}
                          </span>
                        )}
                        {isCurrent ? (
                          <Badge variant="outline" className="shrink-0 text-[0.5625rem]">
                            {t('当前')}
                          </Badge>
                        ) : isAdded ? (
                          <Badge variant="secondary" className="shrink-0 text-[0.5625rem]">
                            {t('已添加')}
                          </Badge>
                        ) : null}
                      </button>
                    );
                  })}
                  {remoteVisible.length === 0 && (
                    <div className="px-2 py-2 text-center text-[0.6875rem] text-muted-foreground">
                      {t('没有匹配的模型')}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="modelId">{t('模型 ID *')}</Label>
              <Input
                id="modelId"
                placeholder="MiniMax-M2.7-highspeed"
                value={modelDialog.data.id}
                onChange={(e) => setModelDialog((d) => ({ ...d, data: { ...d.data, id: e.target.value } }))}
              />
              {modelDialog.editMode && (
                <p className="mt-1 text-[0.625rem] text-muted-foreground">
                  {t('改 ID 等于重命名模型：默认模型的选择会跟着改，历史会话保留当时使用的 ID。')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="modelName">{t('模型名称 *')}</Label>
              <Input
                id="modelName"
                placeholder="MiniMax-M2.7-highspeed"
                value={modelDialog.data.name}
                onChange={(e) => setModelDialog((d) => ({ ...d, data: { ...d.data, name: e.target.value } }))}
              />
            </div>
            <div>
              <Label htmlFor="modelInput">{t('模型类型')}</Label>
              <Select
                value={getModelInputType(modelDialog.data) === 'multimodal' ? 'multimodal' : 'text'}
                onValueChange={(value: string) =>
                  setModelDialog((d) => ({
                    ...d,
                    data: { ...d.data, input: value === 'multimodal' ? ['text', 'image'] : ['text'] },
                  }))
                }
              >
                <SelectTrigger id="modelInput">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" />
                      <span>{t('纯文本语言模型')}</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="multimodal">
                    <div className="flex items-center gap-2">
                      <EyeIcon className="h-3.5 w-3.5" />
                      <span>{t('多模态视觉模型')}</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[0.625rem] text-muted-foreground">
                {t('视觉模型可以接收图片；语言模型只接收文本')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModelDialog({ open: false, providerName: '', editMode: false, originalId: '', data: { ...DEFAULT_MODEL } })}>
              {t('取消')}
            </Button>
            <Button onClick={handleSaveModel}>{t('保存')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete provider confirmation */}
      <AlertDialog open={!!deleteProvider} onOpenChange={(open: boolean) => !open && setDeleteProvider(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('删除服务商？')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('确定删除服务商「{name}」吗？它下面的所有模型配置也会一起删除。', {
                name: deleteProvider ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeleteProvider} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete model confirmation */}
      <AlertDialog open={!!deleteModel} onOpenChange={(open: boolean) => !open && setDeleteModel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('删除模型？')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('确定删除模型「{id}」吗？', { id: deleteModel?.modelId ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeleteModel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
