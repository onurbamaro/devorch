/**
 * task-filter.ts — Per-task filtering primitives for phase init.
 *
 * Pure functions for matching explore-cache sections to the file references
 * that appear in a task's content.
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

/**
 * Filter cache sections (delimited by `## ` headers) to those whose body
 * references any of the provided file refs or directory prefixes. When the ref
 * set is empty the cache is returned unchanged.
 */
export function filterCacheByRefs(cache: string, fileRefs: Set<string>): string {
  if (!cache || fileRefs.size === 0) return cache;

  const sections = cache.split(/(?=^## )/m);
  const matched: string[] = [];

  for (const section of sections) {
    if (!section.startsWith("## ")) {
      matched.push(section);
      continue;
    }
    let sectionMatches = false;
    for (const ref of fileRefs) {
      if (section.includes(ref)) {
        sectionMatches = true;
        break;
      }
    }
    if (!sectionMatches) {
      for (const ref of fileRefs) {
        const dir = ref.split("/")[0];
        if (dir && section.toLowerCase().includes(dir.toLowerCase())) {
          sectionMatches = true;
          break;
        }
      }
    }
    if (sectionMatches) {
      matched.push(section);
    }
  }

  return matched.join("").trim();
}
