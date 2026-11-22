import { Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCreateWorkspace } from '@/hooks/use-create-workspace';
import { useSDK } from '@/hooks/use-sdk';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';

export function WorkspaceCreateButton() {
  const { t } = useI18n();
  const sdk = useSDK();
  const createMutation = useCreateWorkspace();

  // Shares the dropdown's query key. With no workspaces the dropdown itself
  // becomes the "choose the first folder" action, so a second + beside it
  // would just do the same thing twice.
  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => sdk.workspace.list(),
  });
  if (isLoading || !workspaces || workspaces.length === 0) return null;

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
