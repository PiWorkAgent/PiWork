import { Plus } from 'lucide-react';
import { useCreateWorkspace } from '@/hooks/use-create-workspace';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';

export function WorkspaceCreateButton() {
  const { t } = useI18n();
  const createMutation = useCreateWorkspace();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('创建工作区')}
      disabled={createMutation.isPending}
      onClick={() => createMutation.mutate()}
    >
      <Plus className="h-4 w-4" />
    </Button>
  );
}
