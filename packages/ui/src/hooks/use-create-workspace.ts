import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSDK } from '@/hooks/use-sdk';
import { switchWorkspace } from '@/lib/switch-workspace';
import { toast } from '@/stores/toast-store';
import { t } from '@/i18n';
import type { Workspace } from '@pi/types';

function folderBasename(filePath: string): string {
  return filePath.split(/[/\\]/).filter(Boolean).pop() || filePath;
}

/**
 * Ask for a folder, register it as a workspace and switch to it.
 *
 * Shared by the title-bar `+` and the centre panel's "no workspace" empty
 * state: both need exactly the same sequence (pick → create → seed the list →
 * switch), and `switchWorkspace` prepares the new conversation before the
 * switch, so the centre panel never flashes through a session-less frame.
 *
 * Resolves to `null` when the picker was cancelled — not an error, so no toast.
 */
export function useCreateWorkspace() {
  const sdk = useSDK();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<Workspace | null> => {
      const path = await sdk.transport.request('system.selectDirectory');
      if (!path || typeof path !== 'string') return null;
      return sdk.workspace.create(folderBasename(path), path);
    },
    onSuccess: (result) => {
      if (!result) return;
      // Immediately insert into cache so the dropdown shows it
      queryClient.setQueryData<Workspace[]>(['workspaces'], (old) =>
        old ? [result, ...old] : [result],
      );
      // Auto-select the new workspace (with its conversation prepared, so the
      // centre panel doesn't flash through a session-less frame).
      switchWorkspace(sdk, queryClient, result.id);
      // Background refresh for eventual consistency
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: (err) => {
      toast(err instanceof Error ? err.message : t('创建工作区失败'), 'error');
    },
  });
}
