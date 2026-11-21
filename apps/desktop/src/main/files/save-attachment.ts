import { existsSync, promises as fsp, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { SaveAttachmentInput, SavedAttachment } from '@pi/types';
import { uniquePath } from './import-files.js';

/**
 * Copy a composer attachment into the window's workspace so it has a real
 * path: the right panel can preview it, a reload can find it again, and the
 * model can open it instead of searching the disk by file name.
 *
 * Files from outside the workspace land in `<workspace>/.piwork/attachments/`;
 * a file already inside the workspace is referenced where it is. Every
 * destination is derived from the workspace root (never supplied by the
 * renderer), names are sanitized to a basename, and collisions become
 * `name (1).ext` — the same rules as `importFilesIntoWorkspace`.
 */

/** Where attachments live, relative to the workspace root. */
export const ATTACHMENTS_DIR = '.piwork/attachments';

/** Win32 device names are reserved even with an extension (`CON.txt`). */
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function safeName(raw: unknown): string {
  // Split separators by hand instead of `basename`: on Windows, basename also
  // strips an `X:` prefix as a drive, so `a:b.pdf` became `b.pdf` there and
  // `a_b.pdf` on POSIX — a name that worked on one platform and silently
  // changed on another.
  const base =
    String(raw ?? '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.trim() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  // Characters Win32 rejects outright (`< > : " / \ | ? *`), plus the trailing
  // dots/spaces Win32 silently normalizes — leaving those in makes `writeFile`
  // fail with EINVAL on Windows, or collapses two names into one and defeats
  // the collision check.
  const sanitized = cleaned
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') return 'attachment';
  const safe = WINDOWS_RESERVED_RE.test(sanitized) ? `_${sanitized}` : sanitized;
  if (safe.length <= 180) return safe;
  // Keep the extension when truncating an absurdly long name.
  const ext = extname(safe);
  const stemLimit = Math.max(1, 180 - ext.length);
  return safe.slice(0, stemLimit) + ext;
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function relativePathOf(root: string, target: string): string {
  return relative(root, target).split(sep).join('/');
}

export async function saveAttachmentIntoWorkspace(
  workspaceRoot: string,
  input: unknown,
): Promise<SavedAttachment> {
  if (typeof workspaceRoot !== 'string' || !workspaceRoot || !isAbsolute(workspaceRoot)) {
    throw new Error('Workspace root must be an absolute path');
  }
  const root = resolve(workspaceRoot);
  if (!statSync(root).isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${root}`);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Attachment input must be an object');
  }
  const { sourcePath, dataBase64, name } = input as SaveAttachmentInput;

  // Already inside the workspace: reference it in place instead of making a
  // duplicate. A file the user picked from the attachment folder gets the
  // same treatment, so re-attaching never grows the folder.
  if (typeof sourcePath === 'string' && sourcePath && isAbsolute(sourcePath)) {
    const resolvedSource = resolve(sourcePath);
    if (isWithin(resolvedSource, root) && existsSync(resolvedSource) && statSync(resolvedSource).isFile()) {
      return {
        path: resolvedSource,
        relativePath: relativePathOf(root, resolvedSource),
        name: basename(resolvedSource),
      };
    }
  }

  const dir = join(root, ATTACHMENTS_DIR);
  await fsp.mkdir(dir, { recursive: true });

  const destination = uniquePath(dir, safeName(name), false);

  try {
    if (typeof sourcePath === 'string' && sourcePath) {
      if (!isAbsolute(sourcePath)) throw new Error('Attachment source must be an absolute path');
      const source = resolve(sourcePath);
      if (!existsSync(source) || !statSync(source).isFile()) {
        throw new Error(`Attachment source is not a file: ${source}`);
      }
      await fsp.copyFile(source, destination);
    } else if (typeof dataBase64 === 'string' && dataBase64) {
      await fsp.writeFile(destination, Buffer.from(dataBase64, 'base64'));
    } else {
      throw new Error('Attachment has no file source');
    }
  } catch (err) {
    // A half-written destination must not look like a stored attachment.
    await fsp.rm(destination, { force: true }).catch(() => {});
    throw err;
  }

  return {
    path: destination,
    relativePath: relativePathOf(root, destination),
    name: basename(destination),
  };
}
