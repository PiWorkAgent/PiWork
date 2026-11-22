import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import type { ProviderAuthRow } from '@pi/types';
import { cn } from '@/lib/utils';

interface ProviderRowProps {
  row: ProviderAuthRow;
  onConnect: (row: ProviderAuthRow) => void;
  onLogout: (row: ProviderAuthRow) => void;
}

/** Method chips: what this provider accepts, independent of current state. */
function MethodBadges({ row }: { row: ProviderAuthRow }) {
  const { t } = useI18n();
  return (
    <>
      {row.methods.map((method) => (
        <Badge key={method.type} variant="secondary" className="shrink-0 text-[0.625rem]">
          {method.type === 'api_key'
            ? t('API Key')
            : method.subscription
              ? t('订阅')
              : t('OAuth')}
        </Badge>
      ))}
      {row.custom && (
        <Badge variant="outline" className="shrink-0 text-[0.625rem] text-muted-foreground">
          {t('自定义')}
        </Badge>
      )}
    </>
  );
}

/**
 * One row in 内置服务商.
 *
 * Three states the compact row has to carry at a glance: connected (a stored
 * credential), ambient (env var / cloud chain / models.json key — usable but
 * nothing to log out of), and unconnected. `sourceLabel` is the SDK's own
 * description ("ANTHROPIC_API_KEY", "OAuth"), so the second line explains
 * *why* a provider works without inventing a mapping table.
 */
export function ProviderRow({ row, onConnect, onLogout }: ProviderRowProps) {
  const { t } = useI18n();
  const canConnect = row.methods.some((method) => method.interactive);

  const statusText =
    row.health === 'connected'
      ? row.storedType === 'oauth'
        ? t('已连接 · 订阅')
        : t('已连接 · API Key')
      : row.health === 'ambient'
        ? row.source === 'models_json_key' || row.source === 'models_json_command'
          ? t('已连接 · 配置文件')
          : t('已连接 · 环境变量')
        : t('未连接');

  const detail =
    row.health === 'connected'
      ? row.storedType === 'oauth'
        ? t('订阅登录')
        : t('API Key 已保存')
      : row.health === 'ambient'
        ? (row.sourceLabel ?? t('环境变量'))
        : t('{count} 个模型', { count: row.modelCount });

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{row.name}</span>
          <MethodBadges row={row} />
          {row.overridesBuiltin && (
            <Badge variant="outline" className="shrink-0 text-[0.625rem] text-muted-foreground">
              {t('覆盖内置配置')}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={detail}>
          {detail}
          {row.health !== 'none' && ` · ${t('{count} 个模型', { count: row.modelCount })}`}
        </p>
      </div>

      <span
        className={cn(
          'shrink-0 text-xs',
          row.health === 'none' ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {statusText}
      </span>

      <div className="flex w-[92px] shrink-0 justify-end">
        {row.storedType ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onLogout(row)}
          >
            {t('登出')}
          </Button>
        ) : row.ambientOnly ? (
          <span className="text-[0.625rem] text-muted-foreground">{t('云端凭据')}</span>
        ) : canConnect ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onConnect(row)}>
            {t('连接')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
