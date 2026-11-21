import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Cpu, Search } from 'lucide-react';
import type { ModelInfo } from '@pi/types';
import { matchesModelSelection, preferredModelSelection } from '@pi/sdk-wrapper';
import { useSDK } from '@/hooks/use-sdk';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface ModelSelectorProps {
  value?: string;
  onChange?: (modelId: string) => void;
}

/**
 * The composer's model picker.
 *
 * Once built-in providers are connected the list can be hundreds of models
 * (OpenRouter alone ships ~400), so this is a searchable popover grouped by
 * provider rather than a flat select. The saved value keeps the historical
 * bare id unless two providers serve the same id — then `provider/id`, which
 * the chat service already resolves.
 */
export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { t } = useI18n();
  const sdk = useSDK();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: models, isLoading } = useQuery({
    queryKey: ['models'],
    queryFn: () => sdk.config.listModels(),
  });

  const list = useMemo(() => models ?? [], [models]);
  const selected = list.find((model) => matchesModelSelection(value ?? '', model));

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? list.filter(
          (model) =>
            model.name.toLowerCase().includes(needle) ||
            model.id.toLowerCase().includes(needle) ||
            model.providerName.toLowerCase().includes(needle),
        )
      : list;
    const byProvider = new Map<string, ModelInfo[]>();
    for (const model of filtered) {
      const group = byProvider.get(model.providerName);
      if (group) group.push(model);
      else byProvider.set(model.providerName, [model]);
    }
    return [...byProvider.entries()].map(([providerName, items]) => ({ providerName, items }));
  }, [list, query]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-model-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const choose = (model: ModelInfo) => {
    onChange?.(preferredModelSelection(list, model));
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((i) => Math.min(i + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const model = flat[highlight];
      if (model) choose(model);
    }
  };

  if (isLoading) return <Skeleton className="h-7 w-[7.5rem] shrink-0" />;

  // A squeezed composer truncates the name to a stub; the title keeps the
  // full one a hover away.
  const currentName = selected?.name ?? value ?? '';

  let index = -1;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-auto min-w-[4.5rem] max-w-[9.375rem] shrink items-center gap-1 rounded-md border-0 bg-transparent px-2 text-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring @[560px]:max-w-[13.75rem]"
          aria-label={t('选择模型')}
          title={currentName || undefined}
        >
          <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{currentName || t('选择模型')}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('搜索模型…')}
            aria-label={t('搜索模型')}
            spellCheck={false}
            className="h-6 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
        <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
          {flat.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {list.length === 0 ? (
                <>
                  <p>{t('还没有可用的模型。')}</p>
                  <p className="mt-1">{t('去设置 → 模型 连接服务商，或添加自定义服务商。')}</p>
                </>
              ) : (
                t('没有匹配的模型')
              )}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.providerName}>
              <div className="px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.providerName}
              </div>
              {group.items.map((model) => {
                index += 1;
                const itemIndex = index;
                const isSelected = selected?.id === model.id && selected?.providerId === model.providerId;
                return (
                  <button
                    key={`${model.providerId}:${model.id}`}
                    type="button"
                    data-model-index={itemIndex}
                    onMouseEnter={() => setHighlight(itemIndex)}
                    onClick={() => choose(model)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs',
                      itemIndex === highlight && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{model.name}</span>
                    {isSelected && <Check className="h-3 w-3 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
