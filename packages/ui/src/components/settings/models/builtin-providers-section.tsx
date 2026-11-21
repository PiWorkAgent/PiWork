import { useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import type { ProviderAuthRow } from '@pi/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthProvidersQuery } from '@/lib/auth-client';
import { useI18n } from '@/i18n';
import { ProviderRow } from './provider-row';

interface BuiltinProvidersSectionProps {
  onConnect: (row: ProviderAuthRow) => void;
  onLogout: (row: ProviderAuthRow) => void;
}

/**
 * 内置服务商 — every provider the Pi SDK ships, with its sign-in state.
 *
 * The list is long (40+) on purpose: the SDK's catalog is the product. A
 * search box and connected-first ordering keep it usable; nothing is hidden
 * behind a "show all".
 */
export function BuiltinProvidersSection({ onConnect, onLogout }: BuiltinProvidersSectionProps) {
  const { t } = useI18n();
  const { data, isLoading, isFetching, error, refetch } = useAuthProvidersQuery();
  const [query, setQuery] = useState('');

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  return (
    <section aria-label={t('内置服务商')}>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t('内置服务商')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('用订阅或 API Key 登录后，它的模型会出现在模型选择器里。')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('搜索服务商…')}
              aria-label={t('搜索服务商')}
              className="h-7 w-40 pl-7 text-xs"
              spellCheck={false}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('刷新状态')}
            title={t('刷新状态')}
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t('读取服务商失败：{message}', {
            message: error instanceof Error ? error.message : String(error),
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center rounded-lg border py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-xs text-muted-foreground">
          {rows.length === 0 ? t('没有可用的内置服务商') : t('没有匹配的服务商')}
        </p>
      ) : (
        <div className="divide-y rounded-lg border px-3">
          {filtered.map((row) => (
            <ProviderRow key={row.id} row={row} onConnect={onConnect} onLogout={onLogout} />
          ))}
        </div>
      )}

      <p className="pt-2 text-[0.6875rem] leading-relaxed text-muted-foreground/80">
        {t('Bedrock、Vertex 等使用云环境凭据（AWS、GCP）的服务商无需在这里登录。')}
      </p>
    </section>
  );
}
