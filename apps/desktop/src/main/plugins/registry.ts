import { app } from 'electron';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  type Dirent,
} from 'fs';
import { join, resolve, dirname, delimiter } from 'path';
import type {
  PluginManifest,
  PluginRuntimeState,
  PluginSource,
  PluginInfo,
  PluginShadowedCopy,
} from '@pi/types';
import { MIN_SUPPORTED_API_VERSION, PLUGIN_PROTOCOL_VERSION } from '@pi/types';
import { satisfiesVersion } from './semver';

/** Host app id used in `engines` negotiation. */
export const HOST_ENGINE_KEY = 'pi-desktop';

export const PLUGIN_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * A catalog version becomes a path segment (`<id>-<version>` in `.staging`)
 * before the manifest is validated, so it has to be path-safe on its own:
 * semver characters only, no separators, no `..`.
 */
export const SAFE_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

export function isSafePluginId(id: unknown): id is string {
  return typeof id === 'string' && PLUGIN_ID_RE.test(id);
}

export function isSafePluginVersion(version: unknown): version is string {
  return typeof version === 'string' && SAFE_VERSION_RE.test(version) && !version.includes('..');
}

export interface ResolvedPlugin {
  manifest: PluginManifest;
  rootPath: string;
  source: PluginSource;
  enabled: boolean;
  state: PluginRuntimeState;
  error?: string;
  /** Same-id copies from lower-priority roots, for display only. */
  shadowed?: PluginShadowedCopy[];
}

/** Shape of ~/.pi/agent/plugins/_state.json */
export interface PluginsStateFile {
  /**
   * Marketplace index URL — an `https://…` address or an absolute file path.
   * Setting this is how a packaged app talks to a registry other than the
   * official one; without it the env var would be the only override, and an
   * installed app cannot be given one.
   */
  registry?: string;
  plugins?: Record<string, { enabled?: boolean }>;
}

const SOURCE_PRIORITY: Record<PluginSource, number> = { dev: 3, user: 2 };

/**
 * Multi-root plugin discovery with priority resolution.
 *
 * Roots, highest priority first:
 *   1. dev  — paths from the PI_DEV_PLUGINS env var (colon-separated)
 *   2. user — ~/.pi/agent/plugins/  (installed plugins)
 */
export class PluginRegistry {
  private plugins = new Map<string, ResolvedPlugin>();
  private stateFile: PluginsStateFile = {};
  private agentDir: string;
  private appVersionValue: string;

  constructor(opts?: { agentDir?: string; appVersion?: string }) {
    this.agentDir = opts?.agentDir ?? getAgentDir();
    this.appVersionValue = opts?.appVersion ?? app.getVersion();
  }

  // ── Paths ──

  get appVersion(): string {
    return this.appVersionValue;
  }

  /**
   * Explicit marketplace index override: `PI_PLUGIN_REGISTRY` for a dev
   * session, `_state.json#registry` for an installed app (a mirror, a private
   * registry, or a local market directory). Undefined means "use the default
   * hosted registry" — the built-in fallback is NOT a default here: returning
   * it would pin every install/update to whatever shipped with the app.
   * `PluginMarketplace` uses it only when the hosted index is unreachable, and
   * only if the build ships a snapshot at all (the default installer does not).
   */
  get registryUrl(): string | undefined {
    return process.env.PI_PLUGIN_REGISTRY ?? this.stateFile.registry;
  }

  /**
   * The offline market shipped via extraResources at `<resources>/market`.
   * In dev, `process.resourcesPath` points into the Electron dist where no
   * market exists, so this stays undefined and nothing changes.
   */
  get bundledRegistryUrl(): string | undefined {
    return this.bundledRegistryIndex();
  }

  private bundledRegistryIndex(): string | undefined {
    try {
      const bundled = join(process.resourcesPath, 'market', 'index.json');
      return existsSync(bundled) ? bundled : undefined;
    } catch {
      return undefined;
    }
  }

  get pluginsRoot(): string {
    return join(this.agentDir, 'plugins');
  }

  get pluginsDataRoot(): string {
    return join(this.agentDir, 'plugins', '_data');
  }

  getDataDir(pluginId: string): string {
    return join(this.pluginsDataRoot, pluginId);
  }

  /**
   * Where the version a plugin was upgraded FROM is kept.
   *
   * A dot-directory, so `collectFrom` skips it — it holds a plugin the scanner
   * must not load, because the live copy at `<root>/plugins/<id>` is the one
   * that runs until a rollback swaps them.
   */
  getPreviousDir(pluginId: string): string {
    return join(this.pluginsRoot, '.previous', pluginId);
  }

  /** The version a rollback would restore, or undefined when there is none. */
  getPreviousVersion(pluginId: string): string | undefined {
    try {
      const raw = readFileSync(join(this.getPreviousDir(pluginId), 'manifest.json'), 'utf-8');
      return (JSON.parse(raw) as PluginManifest).version;
    } catch {
      return undefined;
    }
  }

  private get stateFilePath(): string {
    return join(this.agentDir, 'plugins', '_state.json');
  }

  private getDevPaths(): string[] {
    const env = process.env.PI_DEV_PLUGINS;
    // `path.delimiter` — `:` on POSIX but `;` on Windows, where splitting on
    // `:` tears `C:\work\Plugin` into `C` and `\work\Plugin` and the checkout
    // never loads.
    return env
      ? env
          .split(delimiter)
          .map((p) => p.trim())
          .filter(Boolean)
      : [];
  }

  // ── State file ──

  loadState(): void {
    try {
      if (existsSync(this.stateFilePath)) {
        this.stateFile = JSON.parse(readFileSync(this.stateFilePath, 'utf-8'));
      }
    } catch (err) {
      console.warn('[plugins] Failed to read _state.json:', err);
      this.stateFile = {};
    }
  }

  private saveState(): void {
    try {
      // The file lives in `plugins/`, not in `agentDir` itself — on a machine
      // that has never installed a plugin that subdirectory does not exist yet,
      // and mkdir'ing only `agentDir` sent this through the catch below as a
      // silent ENOENT, so the first enable/disable never persisted.
      mkdirSync(dirname(this.stateFilePath), { recursive: true });
      writeFileSync(this.stateFilePath, JSON.stringify(this.stateFile, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[plugins] Failed to write _state.json:', err);
    }
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    this.stateFile.plugins = this.stateFile.plugins ?? {};
    this.stateFile.plugins[pluginId] = { ...(this.stateFile.plugins[pluginId] ?? {}), enabled };
    this.saveState();
    plugin.enabled = enabled;
  }

  /**
   * Drop a plugin's saved preference — used on uninstall.
   *
   * The entry outlived the code: uninstalling left `enabled: false` behind, so
   * a later reinstall of the same id arrived already disabled and the user had
   * to hunt for a switch to turn it on. The preference belongs to the copy it
   * was set on. Everything else in the file (the registry override) is kept.
   */
  forgetPlugin(pluginId: string): void {
    if (!this.stateFile.plugins || !(pluginId in this.stateFile.plugins)) return;
    delete this.stateFile.plugins[pluginId];
    if (Object.keys(this.stateFile.plugins).length === 0) delete this.stateFile.plugins;
    this.saveState();
  }

  // ── Scanning ──

  /** Scan all roots, validate manifests, negotiate engines, and dedupe by priority. */
  scan(): ResolvedPlugin[] {
    this.loadState();
    this.plugins.clear();

    const candidates = new Map<string, { manifest: PluginManifest; rootPath: string; source: PluginSource }>();
    /** Losers of the id collision, keyed by id — reported, never loaded. */
    const shadowed = new Map<string, PluginShadowedCopy[]>();

    const collectFrom = (rootPath: string, source: PluginSource) => {
      if (!rootPath || !existsSync(rootPath)) return;
      let entries: Dirent[];
      try {
        entries = readdirSync(rootPath, { withFileTypes: true });
      } catch (err) {
        // An unreadable root — ACLs, a disconnected network/OneDrive home, a
        // directory swapped out mid-scan — must not abort the scan: `scan()`
        // runs during plugin-kernel boot, and a throw here rejected `init()`
        // and skipped the rest of the main-process boot chain.
        console.warn(`[plugins] Cannot scan ${rootPath}:`, err);
        return;
      }

      // A root may itself be a plugin directory (single-plugin dev path).
      if (existsSync(join(rootPath, 'manifest.json'))) {
        this.addCandidate(candidates, shadowed, rootPath, source);
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name === '_data') continue;  // plugin data, not a plugin
        const dirPath = join(rootPath, entry.name);
        let isDir = entry.isDirectory();
        if (!isDir && entry.isSymbolicLink()) {
          // readdir reports symlinks (and Windows junctions, which are reparse
          // points) as non-directories. Relocating a plugin behind a link into
          // another drive/folder is a normal workflow; follow it.
          try {
            isDir = statSync(dirPath).isDirectory();
          } catch {
            isDir = false;
          }
        }
        if (!isDir) continue;
        this.addCandidate(candidates, shadowed, dirPath, source);
      }
    };

    // Priority order matters: later (lower-priority) sources never override.
    for (const p of this.getDevPaths()) collectFrom(resolve(p), 'dev');
    collectFrom(this.pluginsRoot, 'user');

    const enabledMap = this.stateFile.plugins ?? {};
    for (const [id, candidate] of candidates) {
      const plugin: ResolvedPlugin = {
        manifest: candidate.manifest,
        rootPath: candidate.rootPath,
        source: candidate.source,
        enabled: enabledMap[id]?.enabled !== false, // enabled by default
        state: 'registered',
      };
      const hidden = shadowed.get(id);
      if (hidden?.length) plugin.shadowed = hidden;
      // engines negotiation
      const range = candidate.manifest.engines?.[HOST_ENGINE_KEY];
      if (range && !satisfiesVersion(this.appVersion, range)) {
        plugin.state = 'incompatible';
        plugin.error = `requires ${HOST_ENGINE_KEY} ${range}, host is ${this.appVersion}`;
      }
      // Protocol negotiation against a RANGE, not an exact match — see
      // MIN_SUPPORTED_API_VERSION / PLUGIN_PROTOCOL_VERSION in @pi/types.
      // Outside the range the plugin is parked in `incompatible` with a reason
      // saying WHICH side has to move (update the plugin vs. update the app),
      // rather than loading and failing quietly somewhere deep in a panel.
      const declared = candidate.manifest.apiVersion;
      if (
        plugin.state !== 'incompatible' &&
        declared !== undefined &&
        (declared < MIN_SUPPORTED_API_VERSION || declared > PLUGIN_PROTOCOL_VERSION)
      ) {
        plugin.state = 'incompatible';
        plugin.error =
          declared < MIN_SUPPORTED_API_VERSION
            ? `declares apiVersion ${declared}, but this host supports ${MIN_SUPPORTED_API_VERSION}–${PLUGIN_PROTOCOL_VERSION}. The plugin targets a retired protocol — update the plugin.`
            : `declares apiVersion ${declared}, but this host supports ${MIN_SUPPORTED_API_VERSION}–${PLUGIN_PROTOCOL_VERSION}. The plugin is newer than the host — update the app.`;
      }
      this.plugins.set(id, plugin);
    }

    return [...this.plugins.values()];
  }

  private addCandidate(
    candidates: Map<string, { manifest: PluginManifest; rootPath: string; source: PluginSource }>,
    shadowed: Map<string, PluginShadowedCopy[]>,
    dir: string,
    source: PluginSource,
  ): void {
    const validated = this.validateManifestDir(dir);
    if (!validated) return;
    const { manifest } = validated;
    const existing = candidates.get(manifest.id);
    const record = (m: PluginManifest, rootPath: string, src: PluginSource): void => {
      const list = shadowed.get(manifest.id) ?? [];
      // Same root rescanned (a path listed twice in PI_DEV_PLUGINS) is not a
      // second copy — reporting it would turn a config typo into a phantom.
      if (list.some((s) => s.rootPath === rootPath)) return;
      list.push({ source: src, version: m.version, rootPath });
      shadowed.set(manifest.id, list);
    };
    if (existing) {
      if (SOURCE_PRIORITY[existing.source] >= SOURCE_PRIORITY[source]) {
        record(manifest, dir, source);
        return;
      }
      record(existing.manifest, existing.rootPath, existing.source);
    }
    candidates.set(manifest.id, { manifest, rootPath: dir, source });
  }

  /** Read + validate a manifest.json in `dir`. Returns null (with a log) when invalid. */
  private validateManifestDir(dir: string): { manifest: PluginManifest } | null {
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      console.warn(`[plugins] Invalid manifest.json in ${dir}:`, err);
      return null;
    }

    const manifest = raw as PluginManifest;
    if (!PLUGIN_ID_RE.test(manifest.id ?? '')) {
      console.warn(`[plugins] Invalid plugin id "${manifest.id}" in ${dir}`);
      return null;
    }
    if (!manifest.name || !manifest.version) {
      console.warn(`[plugins] Manifest missing name/version in ${dir}`);
      return null;
    }

    // Panel validation. A panel IS a web page: id names it and entry points at
    // it. There is no `kind` — the host decides how to host the page.
    //
    // Entries become URL paths on every platform, so a manifest authored on
    // Windows with `ui\\index.html` is normalized here — otherwise it works on
    // Windows and 404s on macOS/Linux.
    for (const panel of manifest.contributes?.panels ?? []) {
      if (!panel.id) {
        console.warn(`[plugins] Panel without id in ${dir}`);
        return null;
      }
      if (!panel.entry) {
        console.warn(`[plugins] Panel "${panel.id}" has no entry in ${dir}`);
        return null;
      }
      panel.entry = panel.entry.replace(/\\/g, '/').replace(/^\/+/, '');
    }

    // Tool names must be unique within one manifest. The aggregated tool
    // table is keyed by name across ALL plugins, so an intra-manifest
    // duplicate would silently shadow one of the two — reject the manifest,
    // same as any other malformed contribution.
    const toolNames = new Set<string>();
    for (const tool of manifest.contributes?.tools ?? []) {
      if (toolNames.has(tool.name)) {
        console.warn(`[plugins] Duplicate tool name "${tool.name}" in ${dir}`);
        return null;
      }
      toolNames.add(tool.name);
    }

    // Backend entry must exist when declared. Normalize separators first for
    // the same reason as panel entries: `dist\\main.mjs` must resolve (and run)
    // on POSIX too.
    if (manifest.backend) {
      manifest.backend = manifest.backend.replace(/\\/g, '/');
      if (!existsSync(join(dir, manifest.backend))) {
        console.warn(`[plugins] Backend entry "${manifest.backend}" not found in ${dir}`);
        return null;
      }
    }

    return { manifest };
  }

  // ── Accessors ──

  all(): ResolvedPlugin[] {
    return [...this.plugins.values()];
  }

  get(id: string): ResolvedPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Filesystem root serving `pi-plugin://<id>/...` requests. */
  getRoot(id: string): string | undefined {
    return this.plugins.get(id)?.rootPath;
  }

  setState(id: string, state: PluginRuntimeState, error?: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    plugin.state = state;
    plugin.error = error;
  }

  toInfo(plugin: ResolvedPlugin): PluginInfo {
    const { id } = plugin.manifest;
    // An icon is either a file inside the plugin ("./assets/x.svg", served from
    // the plugin's own pi-plugin:// origin) or a name from the host's icon
    // vocabulary ("calendar"). One field, told apart by the leading "./" or "/".
    const iconFileUrl = (value: string | undefined): string | undefined =>
      value && /^[.\\/]/.test(value)
        ? `pi-plugin://${id}/${value.replace(/\\/g, '/').replace(/^\.?\//, '')}`
        : undefined;

    const pluginIconUrl = iconFileUrl(plugin.manifest.icon);
    return {
      id,
      name: plugin.manifest.name,
      description: plugin.manifest.description,
      version: plugin.manifest.version,
      source: plugin.source,
      state: plugin.state,
      permissions: plugin.manifest.permissions ?? [],
      previousVersion: this.getPreviousVersion(id),
      shadowed: plugin.shadowed,
      iconUrl: pluginIconUrl,
      panels: (plugin.manifest.contributes?.panels ?? []).map((p) => ({
        id: p.id,
        title: p.title ?? p.id,
        entry: p.entry,
        // A vocabulary name only survives when the panel did not name a file;
        // otherwise the renderer would draw the name over the file icon.
        icon: iconFileUrl(p.icon) ? undefined : p.icon,
        // Explicit declarations win over the plugin brand: panel icon file >
        // panel vocabulary name > inherited plugin icon > Puzzle.
        iconUrl: iconFileUrl(p.icon) ?? (p.icon ? undefined : pluginIconUrl),
        hidden: p.hidden === true,
        keepAlive: p.keepAlive,
        scope: p.scope,
        multiInstance: p.multiInstance === true,
        region: p.region,
        anchor: p.anchor,
        order: p.order,
        companion: p.companion,
      })),
      commands: (plugin.manifest.contributes?.commands ?? []).map((c) => ({
        name: c.name,
        title: c.title,
        description: c.description,
      })),
      tools: (plugin.manifest.contributes?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
      })),
      messageRenderers: (plugin.manifest.contributes?.messageRenderers ?? []).map((m) => ({
        type: m.type,
        streaming: m.streaming,
      })),
      contextProviders: (plugin.manifest.contributes?.contextProviders ?? []).map((c) => ({
        id: c.id,
        auto: c.auto,
        description: c.description,
      })),
      settings: (plugin.manifest.contributes?.settings ?? []).map((s) => ({
        key: s.key,
        type: s.type,
        label: s.label,
        description: s.description,
        default: s.default,
        options: s.options,
      })),
      error: plugin.error,
    };
  }

  listInfos(): PluginInfo[] {
    return this.all().filter((p) => p.enabled).map((p) => this.toInfo(p));
  }
}
