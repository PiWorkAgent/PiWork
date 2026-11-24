/**
 * Main-process crash capture.
 *
 * A packaged build's stdout goes nowhere and a native crash unwinds no stack,
 * so the only trace of an abnormal exit used to be a line in the OS log. That
 * is how a 31-minute-old session disappeared: the kernel refused the report
 * ("Corpse failure, too many 6 — Too many corpses being created") and left
 * nothing but a timestamp.
 *
 * Two independent recorders now run for the life of the process:
 *
 *  - Electron's crashReporter (Crashpad). It writes a minidump into
 *    `<userData>/Crashpad` for a native crash — a code path that does not
 *    depend on the OS crash reporter, which is exactly what failed before.
 *  - A rolling text log at `<userData>/logs/main.log`: the boot banner, every
 *    console call the main process makes, uncaught exceptions, unhandled
 *    rejections, and every child process (GPU / renderer / utility) that dies,
 *    with Electron's reason and exit code.
 *
 * The text log is written synchronously on purpose: the last line before a
 * crash is the one that matters, so nothing may still be sitting in a buffer.
 *
 * Installed from `index.ts` after `adoptLegacySettings()` — before that point
 * `userData` may still be the legacy directory Electron would otherwise adopt.
 */
import { app, crashReporter } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';
import { APP_NAME } from '@main/branding';

/** Rotate at this size, so a long-lived log cannot grow without bound. */
const LOG_MAX_BYTES = 2 * 1024 * 1024;
/** One runaway console argument must not fill the disk. */
const LINE_MAX_CHARS = 4000;

type Level = 'info' | 'warn' | 'error';

let logFile: string | null = null;
/** Bytes appended since install, so the cap is enforced mid-run, not only at boot. */
let written = 0;

/** Where the main-process log lives, once installed (`null` before that). */
export function mainLogPath(): string | null {
  return logFile;
}

/** Append one line to the main-process log. Safe to call before install (no-op). */
export function logMain(level: Level, scope: string, message: string): void {
  if (!logFile) return;
  let line = `${new Date().toISOString()} [${level}] [${scope}] ${message}\n`;
  if (line.length > LINE_MAX_CHARS) line = line.slice(0, LINE_MAX_CHARS) + '\n';
  try {
    appendFileSync(logFile, line);
    written += line.length;
    if (written >= LOG_MAX_BYTES) {
      renameSync(logFile, `${logFile}.1`);
      written = 0;
    }
  } catch {
    /* the disk is gone; nothing useful left to do */
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function rotate(file: string): void {
  try {
    if (statSync(file).size >= LOG_MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    /* no file yet, or it is unreadable — appending will cope */
  }
}

/**
 * Mirror the main process's console into the log file.
 *
 * Every diagnostic already in the main process — the browser tab that died, the
 * plugin view whose renderer went away, a slot that failed to hide — is a
 * `console.warn` / `console.error`. In a packaged build those calls reach
 * nobody; here they become the trail that explains a crash.
 */
function mirrorConsole(): void {
  const sink: Array<[keyof Console, Level]> = [
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ];
  for (const [method, level] of sink) {
    const original = (console[method] as (...args: unknown[]) => void).bind(console);
    (console[method] as (...args: unknown[]) => void) = (...args: unknown[]) => {
      try {
        logMain(level, 'console', format(...(args as Parameters<typeof format>)));
      } catch {
        /* formatting must never break logging */
      }
      original(...args);
    };
  }
}

/**
 * An exception that escaped every handler. Node would terminate the process;
 * hooking the event disables that, so log first and then rethrow on the next
 * tick — keeping the default outcome (and any crash dialog) while leaving a
 * line behind that says what threw.
 */
function onUncaught(error: unknown): void {
  logMain('error', 'uncaughtException', describe(error));
  process.removeListener('uncaughtException', onUncaught);
  process.nextTick(() => {
    throw error;
  });
}

/**
 * A rejection nobody handled. Logged, not rethrown: Node's default has changed
 * across versions, and turning a benign fire-and-forget promise into a process
 * exit would be a regression of its own. The stack is in the log either way.
 */
function onUnhandledRejection(reason: unknown): void {
  logMain('error', 'unhandledRejection', describe(reason));
}

/** Renderer / GPU / utility process deaths, with Electron's own verdict. */
function onChildProcessGone(
  details: Electron.Details | Electron.RenderProcessGoneDetails,
): void {
  const d = details as {
    type?: string;
    reason?: string;
    exitCode?: number;
    serviceName?: string;
    name?: string;
    sandbox?: boolean;
  };
  const parts = [
    `type=${d.type ?? '?'}`,
    `reason=${d.reason ?? '?'}`,
    `exitCode=${d.exitCode ?? '?'}`,
  ];
  if (d.serviceName) parts.push(`service=${d.serviceName}`);
  if (d.name) parts.push(`name=${d.name}`);
  if (typeof d.sandbox === 'boolean') parts.push(`sandbox=${d.sandbox}`);
  logMain('error', 'child-process-gone', parts.join(' '));
}

/**
 * Install both recorders. Idempotent enough to be called once from the entry
 * point; a second call would only append duplicate handlers, so guard it.
 */
let installed = false;
export function installCrashReporting(): void {
  if (installed) return;
  installed = true;

  const dir = join(app.getPath('userData'), 'logs');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* userData is unwritable; the recorders below simply stay silent */
  }
  logFile = join(dir, 'main.log');
  rotate(logFile);

  // Crashpad first: it has to be up before anything can crash.
  try {
    crashReporter.start({
      productName: APP_NAME,
      companyName: 'PiWork',
      // Local dumps only. Nothing leaves the machine; the file is what a
      // maintainer opens after the fact.
      uploadToServer: false,
      compress: false,
    });
  } catch (err) {
    logMain('warn', 'crashReporter', `start failed: ${describe(err)}`);
  }

  let dumps = '(unavailable)';
  try {
    dumps = app.getPath('crashDumps');
  } catch {
    /* very old Electron or a platform without the path */
  }
  logMain(
    'info',
    'boot',
    `${APP_NAME} ${app.getVersion()} · Electron ${process.versions.electron} · ` +
      `Chromium ${process.versions.chrome} · Node ${process.versions.node} · ` +
      `${process.platform}/${process.arch} · packaged=${app.isPackaged} · pid=${process.pid}`,
  );
  logMain('info', 'boot', `dumps=${dumps} · log=${logFile}`);

  mirrorConsole();

  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUnhandledRejection);

  app.on('child-process-gone', (_event, details) => onChildProcessGone(details));

  // Every webContents (shell, plugin panel, engine view) gets the same
  // treatment: a renderer crash is a fact the user will notice, and the one
  // place that can name it is here.
  app.on('web-contents-created', (_event, wc) => {
    wc.on('render-process-gone', (_e, details) => {
      onChildProcessGone(details);
      logMain(
        'error',
        'render-process-gone',
        `wc=${wc.id} type=${wc.getType()} url=${(() => {
          try {
            return wc.getURL();
          } catch {
            return '?';
          }
        })()}`,
      );
    });
    wc.on('preload-error', (_e, preloadPath, error) => {
      logMain('error', 'preload-error', `${preloadPath}: ${describe(error)}`);
    });
  });

  // A normal quit leaves a closing line; its absence is how a crash is told
  // from a clean exit when reading the log afterwards.
  app.on('will-quit', () => logMain('info', 'will-quit', 'clean shutdown'));
}
