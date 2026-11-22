import { isAbsolute, relative, sep } from 'node:path';

/** True when `child` is `parent` or lives under it (either separator). */
export function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
