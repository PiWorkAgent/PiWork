import type { ReactNode } from 'react';
import { AlertTriangle, FolderPlus, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useCreateWorkspace } from '@/hooks/use-create-workspace';
import { Button } from '@/components/ui/button';

interface EmptyShellProps {
  icon: ReactNode;
  title: string;
  body?: string;
  children?: ReactNode;
}

function EmptyShell({ icon, title, body, children }: EmptyShellProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      {icon}
      <div className="max-w-sm text-center">
        <h3 className="text-lg font-medium">{title}</h3>
        {body && <p className="mt-1 break-words text-sm text-muted-foreground">{body}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * A session id is set but its conversation could not be read back. Rare (the
 * id comes from main's window state), and the generic copy still applies:
 * either pick another conversation or start one.
 */
export function EmptyChat() {
  const { t } = useI18n();
  return (
    <EmptyShell
      icon={<MessageSquare className="h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />}
      title={t('没有进行中的会话')}
      body={t('从左侧选择一个会话，或新建一个开始。')}
    />
  );
}

/**
 * No workspace at all — the state a fresh install lands in.
 *
 * Sessions live inside a workspace (the folder IS the session's cwd in pi), so
 * there is genuinely nothing to start here. Say that, and put the only useful
 * action — pick a folder — in front of the user instead of leaving the centre
 * panel as a dead end pointing at an empty sidebar.
 */
export function NoWorkspaceChat() {
  const { t } = useI18n();
  const createWorkspace = useCreateWorkspace();
  return (
    <EmptyShell
      icon={<FolderPlus className="h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />}
      title={t('还没有工作区')}
      body={t('选一个文件夹作为工作区，PiWork 会在里面创建会话、读写文件。')}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => createWorkspace.mutate()}
        disabled={createWorkspace.isPending}
      >
        <FolderPlus className="mr-2 h-4 w-4" />
        {createWorkspace.isPending ? t('正在打开…') : t('打开文件夹…')}
      </Button>
    </EmptyShell>
  );
}

/**
 * Workspace selected, session being created. Shown while the composer's
 * ensure-session effect runs (and while the transport is still connecting), so
 * the panel never claims "no active session" about a session that is on its
 * way.
 */
export function PreparingSessionChat() {
  const { t } = useI18n();
  return (
    <EmptyShell
      icon={<Loader2 className="h-8 w-8 animate-spin text-muted-foreground/60" strokeWidth={1.5} />}
      title={t('正在准备会话…')}
      body={t('正在为当前工作区创建会话。')}
    />
  );
}

/**
 * Session creation failed. Without this the panel kept showing the generic
 * empty state and the user had no way to tell a slow start from a broken one.
 */
export function FailedSessionChat({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <EmptyShell
      icon={<AlertTriangle className="h-8 w-8 text-destructive/70" strokeWidth={1.5} />}
      title={t('无法创建会话')}
      body={error || t('请检查后端连接后重试。')}
    >
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" />
        {t('重试')}
      </Button>
    </EmptyShell>
  );
}
