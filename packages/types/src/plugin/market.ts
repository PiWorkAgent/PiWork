/**
 * Plugin marketplace / distribution contract.
 *
 * The official catalog is a static JSON index (see the final design):
 * a list of plugin entries with version + zip download URL + sha256,
 * served from a CDN, git repo or local file path for development.
 */

/** One entry of the static registry index. */
export interface MarketEntry {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  /** Zip download URL (http(s):// or absolute file path for local dev). */
  url: string;
  /**
   * Hex sha256 of the zip. Required: installation aborts on mismatch, and an
   * index without it would install unverified bytes while looking like it had
   * checked them.
   */
  sha256: string;
  size?: number;
  permissions?: string[];
  /**
   * The plugin protocol version the packaged manifest declares, mirrored here
   * so the plugin center can show "needs a newer app / plugin too old" BEFORE
   * the download, not as a surprise after installing. The authoritative check
   * still happens in stageInstall against the manifest inside the zip — a
   * catalog that lies about this field does not get the plugin installed.
   */
  apiVersion?: number;
  /**
   * True for plugins maintained by this project. The registry sets it; a
   * plugin's own release index has no opinion (undefined). Used when deciding
   * what goes into the installer's offline snapshot — community plugins stay
   * online-only.
   */
  official?: boolean;
  /** Free-form registry categories, for browsing/filtering in the plugin center. */
  categories?: string[];
}

/** Shape of the static index document. */
export interface MarketIndex {
  version: number;
  updated?: string;
  plugins: MarketEntry[];
}

/**
 * Order two plugin versions the way the plugin center decides "can update".
 *
 * Returns 0 when either side is not a full `major.minor.patch`: an
 * unrecognisable version must never read as an update, because acting on that
 * comparison would offer a download for nothing. A pre-release (`1.0.0-dev.2`,
 * the market's stamped development builds) sorts below its final release.
 */
export function comparePluginVersions(a: string, b: string): number {
  const pa = parsePluginVersion(a);
  const pb = parsePluginVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

function parsePluginVersion(raw: string): { nums: [number, number, number]; pre: string | null } | null {
  const m = /^[\s=v]*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(raw.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/** Human-readable permission metadata shown in the consent dialog. */
export interface PermissionMeta {
  key: string;
  label: string;
  description: string;
}

export const PERMISSION_META: PermissionMeta[] = [
  { key: 'storage', label: '本地存储', description: '插件私有数据目录读写(plugins-data/<id>)' },
  { key: 'notify', label: '桌面通知', description: '发送系统通知' },
  { key: 'messages', label: '会话消息', description: '往会话里发送插件消息（默认不进入 AI 上下文）' },
  { key: 'clipboard', label: '剪贴板', description: '读写系统剪贴板' },
  { key: 'browser', label: '浏览器控制', description: '驱动宿主浏览器自动化能力' },
  { key: 'network', label: '网络访问', description: '出站网络请求(按域名限定)' },
  { key: 'secrets', label: '凭据保管箱', description: '读取指定命名空间的凭据(系统钥匙串加密)' },
];

export function describePermission(permission: string): PermissionMeta {
  const base = permission.split(':')[0];
  return (
    PERMISSION_META.find((p) => p.key === base) ?? {
      key: permission,
      label: permission,
      description: '插件声明的自定义权限',
    }
  );
}

/** Install progress phases reported to the renderer. */
export type InstallPhase = 'downloading' | 'verifying' | 'installing' | 'activating';

export interface InstallResult {
  ok: boolean;
  error?: string;
  pluginId?: string;
}
