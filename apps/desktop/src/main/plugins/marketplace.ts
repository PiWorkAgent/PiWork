import { net } from 'electron';
import AdmZip from 'adm-zip';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import type { MarketEntry, MarketIndex, PluginManifest } from '@pi/types';
import { MIN_SUPPORTED_API_VERSION, PLUGIN_PROTOCOL_VERSION } from '@pi/types';
import type { PluginRegistry } from './registry';
import { satisfiesVersion } from './semver';
import { HOST_ENGINE_KEY } from './registry';

/**
 * The official registry: a static index published as an asset on the
 * `PiWork-Registry` repository's newest GitHub release. It is an AGGREGATE —
 * one entry per plugin, each pointing at that plugin's own repository release.
 * `releases/latest/download` redirects to the asset of the latest stable
 * release, so the URL is stable across releases; downloads go through the
 * plain web endpoint, not the GitHub API, so there is no unauthenticated rate
 * limit to exhaust.
 *
 * Overridden by `PI_PLUGIN_REGISTRY` or `_state.json#registry` for dev, a
 * mirror, or a private registry.
 */
export const DEFAULT_REGISTRY_URL =
  'https://github.com/PiWorkAgent/PiWork-Registry/releases/latest/download/index.json';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Catalog entry URLs may be relative: a bundled market ships its zips beside
 * the index, and the index cannot know the install path ahead of time (and a
 * hosted market may want to move its zips with the index — including a
 * GitHub release, where the index and its zips are sibling assets of the same
 * tag). Absolute paths and full URLs pass through untouched.
 */
export function resolveEntryUrl(indexUrl: string, url: string): string {
  if (isAbsolute(url) || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (/^https?:/i.test(indexUrl)) {
    try {
      return new URL(url, indexUrl).toString();
    } catch {
      /* malformed base — fall through to the path join */
    }
  }
  return join(dirname(indexUrl), url);
}

/**
 * Permissions the package declares that the catalog entry did not.
 *
 * The consent dialog is built from `MarketEntry.permissions` (the catalog),
 * while the host enforces `manifest.permissions` from inside the zip
 * (capability-hub). For the official registry the two are generated from the
 * same manifest, so they agree. A third-party entry can UNDER-report — the
 * user then consents to less than the plugin actually gets, which is the one
 * failure mode this check closes.
 *
 * Exact strings, not base names: scoped `network:api.example.com` and unscoped
 * `network` are different grants, so they must not be treated as equal.
 */
export function undeclaredPermissions(
  entryPermissions: string[] | undefined,
  manifestPermissions: string[] | undefined,
): string[] {
  const declared = new Set(entryPermissions ?? []);
  return [...new Set(manifestPermissions ?? [])].filter((p) => !declared.has(p)).sort();
}

/**
 * Static-index marketplace: fetch catalog, download + verify zips,
 * extract to .staging, validate, and atomically install into the user
 * plugins root.
 */
export class PluginMarketplace {
  private readonly registry: PluginRegistry;
  private indexCache: { at: number; url: string; index: MarketIndex } | null = null;
  private readonly cacheMs = 60_000;

  constructor(registry: PluginRegistry) {
    this.registry = registry;
  }

  /** Registry index URL: _state.json#registry, the env override, or the default. */
  get registryUrl(): string {
    return this.registry.registryUrl ?? DEFAULT_REGISTRY_URL;
  }

  /**
   * Where the last successful catalog fetch actually came from. Normally
   * `registryUrl`; the bundled snapshot when the hosted index was unreachable.
   */
  get activeRegistryUrl(): string {
    return this.indexCache?.url ?? this.registryUrl;
  }

  async catalog(force = false): Promise<MarketEntry[]> {
    if (!force && this.indexCache && Date.now() - this.indexCache.at < this.cacheMs) {
      return this.indexCache.index.plugins;
    }
    // Re-read state so registry URL changes apply without a restart.
    this.registry.loadState();
    const primary = this.registryUrl;
    let url = primary;
    let index: MarketIndex;
    try {
      index = await this.fetchIndex(primary);
    } catch (err) {
      // A machine that cannot reach the hosted registry (offline, blocked,
      // behind an unusual network) still deserves a working plugin center:
      // fall back to the market snapshot shipped inside the install image.
      // The last-resort entry is local, so this cannot loop.
      const fallback = this.registry.bundledRegistryUrl;
      if (!fallback || fallback === primary) throw err;
      try {
        index = await this.fetchIndex(fallback);
        url = fallback;
        console.warn(`[plugins] registry ${primary} unreachable (${errorText(err)}); using bundled market`);
      } catch {
        // Report the hosted failure, not the fallback's: that is the one the
        // user can act on (network / mirror setting).
        throw err;
      }
    }
    this.indexCache = { at: Date.now(), url, index };
    return index.plugins;
  }

  async getEntry(id: string): Promise<MarketEntry | undefined> {
    return (await this.catalog()).find((e) => e.id === id);
  }

  private async fetchIndex(url: string): Promise<MarketIndex> {
    const raw = await this.fetchBytes(url);
    const index = JSON.parse(raw.toString('utf-8')) as MarketIndex;
    if (!index || !Array.isArray(index.plugins)) {
      throw new Error('invalid registry index: missing plugins[]');
    }
    // Resolve entry URLs once, against the index they came from, and hand the
    // rest of the pipeline absolute URLs. Entries used to be resolved at
    // download time against `registryUrl` — which would send a bundled
    // snapshot's relative entries to the hosted host in the fallback case.
    return {
      ...index,
      plugins: index.plugins.map((entry) => ({
        ...entry,
        url: resolveEntryUrl(url, entry.url),
      })),
    };
  }

  private async fetchBytes(url: string): Promise<Buffer> {
    if (/^https?:\/\//i.test(url)) {
      const res = await net.fetch(url);
      if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    // Local file path (dev/test registries)
    if (!existsSync(url)) throw new Error(`registry file not found: ${url}`);
    return readFileSync(url);
  }

  /**
   * Download + verify + validate an entry, returning the extracted staging
   * dir ready to be atomically renamed into the plugins root. The caller
   * (PluginSystem) handles process lifecycle and re-registration.
   */
  async stageInstall(
    entry: MarketEntry,
    onPhase?: (phase: 'downloading' | 'verifying' | 'installing') => void,
  ): Promise<{ stagedDir: string; manifest: PluginManifest }> {
    onPhase?.('downloading');
    // Entries come back from `catalog()` with absolute URLs — already resolved
    // against whichever index (hosted or bundled) actually served them.
    const zipBytes = await this.fetchBytes(entry.url);

    onPhase?.('verifying');
    // Always. A missing digest used to skip the check silently, so an index
    // that forgot one installed unverified bytes while the phase said
    // "verifying" — worse than no check, because it looked like one.
    if (!entry.sha256) {
      throw new Error(`catalog entry ${entry.id} has no sha256 — refusing to install unverified bytes`);
    }
    const actual = createHash('sha256').update(zipBytes).digest('hex');
    if (actual !== entry.sha256.toLowerCase()) {
      throw new Error(`integrity check failed for ${entry.id} (sha256 mismatch)`);
    }

    onPhase?.('installing');
    const zip = new AdmZip(zipBytes);
    // Extract into a fresh staging dir.
    const stagingRoot = join(this.registry.pluginsRoot, '.staging');
    rmSync(join(stagingRoot, `${entry.id}-${entry.version}`), { recursive: true, force: true });
    const extractDir = join(stagingRoot, `${entry.id}-${entry.version}`);
    mkdirSync(extractDir, { recursive: true });
    zip.extractAllTo(extractDir, true);

    // Locate the manifest: zip root, or a single wrapping directory.
    const root = this.findPluginRoot(extractDir);
    if (!root) {
      throw new Error(`zip for ${entry.id} contains no manifest.json`);
    }

    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as PluginManifest;
    if (manifest.id !== entry.id) {
      throw new Error(`manifest id "${manifest.id}" does not match catalog id "${entry.id}"`);
    }
    if (manifest.version !== entry.version) {
      throw new Error(`manifest version "${manifest.version}" does not match catalog version "${entry.version}"`);
    }
    // Consent is shown from the catalog, but the host grants what the manifest
    // says. Refuse before committing anything if the package asks for more
    // than the entry (and therefore the user) was told about.
    const undeclared = undeclaredPermissions(entry.permissions, manifest.permissions);
    if (undeclared.length > 0) {
      throw new Error(
        `"${manifest.id}" ${manifest.version} declares permission(s) the catalog does not list: ` +
          `${undeclared.join(', ')} — refusing to install without consent for them`,
      );
    }
    if (manifest.backend && !existsSync(join(root, manifest.backend))) {
      throw new Error(`backend entry "${manifest.backend}" missing in package`);
    }

    // engines negotiation — refuse before touching the plugins root.
    const appVersion = this.registry.appVersion;
    const range = manifest.engines?.[HOST_ENGINE_KEY];
    if (range && !satisfiesVersion(appVersion, range)) {
      throw new Error(
        `"${manifest.id}" ${manifest.version} requires ${HOST_ENGINE_KEY} ${range}, host is ${appVersion}`,
      );
    }

    // apiVersion negotiation — the same range the registry scan enforces,
    // applied here so an out-of-range plugin fails at INSTALL time with a
    // message saying which side has to move, instead of landing as an inert
    // "incompatible" entry the user has to uninstall again.
    const declared = manifest.apiVersion;
    if (
      declared !== undefined &&
      (declared < MIN_SUPPORTED_API_VERSION || declared > PLUGIN_PROTOCOL_VERSION)
    ) {
      throw new Error(
        declared < MIN_SUPPORTED_API_VERSION
          ? `"${manifest.id}" ${manifest.version} targets protocol ${declared}, this host supports ${MIN_SUPPORTED_API_VERSION}–${PLUGIN_PROTOCOL_VERSION} — the plugin is too old, update the plugin`
          : `"${manifest.id}" ${manifest.version} targets protocol ${declared}, this host supports ${MIN_SUPPORTED_API_VERSION}–${PLUGIN_PROTOCOL_VERSION} — update the app`,
      );
    }

    return { stagedDir: root, manifest };
  }

  private findPluginRoot(extractDir: string): string | null {
    if (existsSync(join(extractDir, 'manifest.json'))) return extractDir;
    // Handle zips that wrap everything in a single folder.
    if (!existsSync(extractDir)) return null;
    const entries = readdirSync(extractDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 1 && existsSync(join(extractDir, dirs[0].name, 'manifest.json'))) {
      return join(extractDir, dirs[0].name);
    }
    return null;
  }

  /** Atomically move a staged dir into the user plugins root. */
  commitInstall(stagedDir: string, pluginId: string): string {
    // Always the USER root, never `registry.getRoot()`: under PI_DEV_PLUGINS
    // that resolves to the repo's copy, and the install would land in the
    // working tree instead of the user's plugin directory.
    const target = join(this.registry.pluginsRoot, pluginId);
    mkdirSync(this.registry.pluginsRoot, { recursive: true });

    // Replace-in-place: move old aside, move new in, drop old.
    const stagingRoot = join(this.registry.pluginsRoot, '.staging');
    const scrapped = join(stagingRoot, `${pluginId}-replaced-${Date.now()}`);
    let moveOldTo = scrapped;

    if (existsSync(target)) {
      const outgoing = this.readVersion(target);
      const incoming = this.readVersion(stagedDir);
      // Keep the outgoing copy ONLY when the version actually changed. A
      // same-version reinstall is the escape hatch for a corrupted copy, and
      // letting it overwrite `.previous` would destroy the one good version
      // the user still had.
      if (outgoing && incoming && outgoing !== incoming) {
        moveOldTo = this.registry.getPreviousDir(pluginId);
        mkdirSync(dirname(moveOldTo), { recursive: true });
        rmSync(moveOldTo, { recursive: true, force: true });
      }
      renameSync(target, moveOldTo);
    }

    renameSync(stagedDir, target);
    if (moveOldTo === scrapped && existsSync(scrapped)) {
      rmSync(scrapped, { recursive: true, force: true });
    }
    return target;
  }

  private readVersion(dir: string): string | null {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')) as PluginManifest;
      return manifest.version ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Put the kept previous version back, and keep the one it replaces — so this
   * is a swap, not a one-way door. The UI labels the action with the target
   * version, which makes pressing it twice read as what it is: a toggle.
   */
  rollback(pluginId: string): { from: string; to: string } {
    const target = join(this.registry.pluginsRoot, pluginId);
    const previous = this.registry.getPreviousDir(pluginId);
    if (!existsSync(previous)) {
      throw new Error(`"${pluginId}" has no previous version to return to`);
    }

    const from = this.readVersion(target) ?? '?';
    const to = this.readVersion(previous) ?? '?';

    const stagingRoot = join(this.registry.pluginsRoot, '.staging');
    mkdirSync(stagingRoot, { recursive: true });
    const aside = join(stagingRoot, `${pluginId}-rolled-${Date.now()}`);

    if (existsSync(target)) renameSync(target, aside);
    renameSync(previous, target);
    if (existsSync(aside)) renameSync(aside, previous);

    return { from, to };
  }
}
