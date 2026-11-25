import { Eye, EyeIcon, EyeOff, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ModelEntry, ProviderEntry } from '@pi/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useI18n } from '@/i18n';

interface CustomProvidersSectionProps {
  providers: Record<string, ProviderEntry>;
  /** Provider ids the SDK already ships, used for the override badge. */
  builtinIds: ReadonlySet<string>;
  visibleKeys: ReadonlySet<string>;
  onToggleKey: (name: string) => void;
  onAddProvider: () => void;
  onEditProvider: (name: string) => void;
  onDeleteProvider: (name: string) => void;
  onAddModel: (providerName: string) => void;
  onEditModel: (providerName: string, model: ModelEntry) => void;
  onDeleteModel: (providerName: string, modelId: string) => void;
}

/**
 * A provider may have no key at all — that is the very state that sends people
 * here, and reading `.length` off it took the whole settings dialog down.
 */
function maskApiKey(key: string | undefined): string {
  if (!key || key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function isMultimodal(model: ModelEntry): boolean {
  return (model.input ?? []).includes('image');
}

/**
 * 自定义服务商 — the models.json half of the page.
 *
 * Built-in providers need no endpoint or key here: signing in above is
 * enough. models.json stays the escape hatch for OpenAI/Anthropic-compatible
 * endpoints Pi does not ship (proxies, Ollama, vLLM, a private gateway).
 */
export function CustomProvidersSection({
  providers,
  builtinIds,
  visibleKeys,
  onToggleKey,
  onAddProvider,
  onEditProvider,
  onDeleteProvider,
  onAddModel,
  onEditModel,
  onDeleteModel,
}: CustomProvidersSectionProps) {
  const { t } = useI18n();
  const entries = Object.entries(providers);

  return (
    <section aria-label={t('自定义服务商')}>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t('自定义服务商（models.json）')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('接入 Pi 未内置的兼容接口，例如本地模型、代理或私有网关。')}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAddProvider}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('添加服务商')}
        </Button>
      </div>

      {entries.length === 0 ? (
        // One slim line, not a box: this section now always sits on top, and
        // an empty state still has to leave the catalog below in view.
        <p className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          {t('还没有自定义服务商。')}
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map(([name, provider]) => (
            <Card key={name} className="overflow-hidden">
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <CardTitle className="truncate text-sm">{name}</CardTitle>
                    {builtinIds.has(name) && (
                      <Badge variant="outline" className="shrink-0 text-[0.625rem] text-muted-foreground">
                        {t('覆盖内置服务商')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={t('编辑服务商')}
                      onClick={() => onEditProvider(name)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      aria-label={t('删除服务商')}
                      onClick={() => onDeleteProvider(name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="shrink-0 text-[0.625rem]">
                      {provider.api}
                    </Badge>
                  </div>
                  <div className="break-all" title={provider.baseUrl}>
                    {provider.baseUrl}
                  </div>
                  <div className="flex items-center gap-1">
                    <code
                      className="min-w-0 break-all rounded bg-muted px-1 text-[0.625rem]"
                      title={provider.apiKey}
                    >
                      {provider.apiKey
                        ? visibleKeys.has(name)
                          ? provider.apiKey
                          : maskApiKey(provider.apiKey)
                        : t('未填写 API Key')}
                    </code>
                    {provider.apiKey && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        aria-label={t('显示 API Key')}
                        onClick={() => onToggleKey(name)}
                      >
                        {visibleKeys.has(name) ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0">
                <Separator className="mb-2" />
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-muted-foreground">
                    {t('模型（{count}）', { count: provider.models.length })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => onAddModel(name)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t('添加模型')}
                  </Button>
                </div>
                {provider.models.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">{t('还没有模型')}</p>
                ) : (
                  <div className="space-y-1">
                    {provider.models.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
                        title={model.id}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate font-medium">{model.name}</span>
                          {isMultimodal(model) ? (
                            <Badge variant="secondary" className="h-4 shrink-0 px-1 py-0 text-[0.5625rem]">
                              <EyeIcon className="mr-0.5 h-2.5 w-2.5" />
                              {t('视觉')}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="h-4 shrink-0 px-1 py-0 text-[0.5625rem] text-muted-foreground"
                            >
                              <FileText className="mr-0.5 h-2.5 w-2.5" />
                              {t('文本')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label={t('编辑模型')}
                            onClick={() => onEditModel(name, model)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            aria-label={t('删除模型')}
                            onClick={() => onDeleteModel(name, model.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
