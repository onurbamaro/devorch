/**
 * task-filter.ts — Per-task filtering primitives for phase init.
 */

/**
 * Extract file-path-ish refs from arbitrary markdown text. Matches backtick-quoted
 * tokens that either contain a `/` or end with a 1–5 character extension.
 */
export function extractFileRefs(text: string): Set<string> {
  const refs = new Set<string>();
  const patterns = [...text.matchAll(/`([^`]*(?:\/[^`]+|\.\w{1,5}))`/g)];
  for (const match of patterns) {
    const ref = match[1];
    if (/\.\w{1,5}$/.test(ref) || ref.includes("/")) {
      refs.add(ref);
    }
  }
  return refs;
}
