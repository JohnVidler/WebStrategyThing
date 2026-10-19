import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const warned = new Set<string>();

/** Warns once per distinct problem: manifests are re-read on every request. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * Reads a JSON manifest array. A missing file is fine (nothing to serve) and returns [];
 * a file that cannot be parsed, or is not an array, is logged so a typo doesn't pass silently.
 */
export async function readManifest(dir: string, name: string): Promise<unknown[]> {
  const path = resolve(dir, name);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (Array.isArray(raw)) return raw;
    warnOnce(`[manifest] ${path} must be a JSON array; ignoring it.`);
  } catch (err) {
    warnOnce(`[manifest] ${path} is not valid JSON, so nothing from it will be served: ${(err as Error).message}`);
  }
  return [];
}
