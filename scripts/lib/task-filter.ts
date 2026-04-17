/**
 * task-filter.ts — Per-task filtering primitives for phase init.
 *
 * Pure functions extracted from init-phase.ts so the compound init script can stay
 * focused on CLI glue, subprocess orchestration, and JSON assembly. Every function
 * here is a byte-for-byte preservation of behavior as it ran inline in init-phase.ts;
 * no logic has been tightened, optimized, or reordered. See init-phase.ts for the
 * original definitions.
 */
import { extractTagContent } from "./plan-parser";

export interface ConventionSection {
  header: string;
  content: string;
}

/** Extension-to-convention matching map. Keys are file extensions (with leading dot),
 *  values are lowercase keywords probed against convention section headers/content. */
export const EXT_KEYWORDS: Record<string, string[]> = {
  ".ts": ["typescript", "ts", "script", "naming", "export", "import", "style", "error", "pattern", "async", "bun", "workaround"],
  ".tsx": ["typescript", "ts", "tsx", "react", "component", "style", "jsx", "naming", "export", "import", "pattern"],
  ".js": ["javascript", "js", "script", "naming", "export", "import", "style", "pattern"],
  ".jsx": ["javascript", "js", "jsx", "react", "component", "style"],
  ".md": ["markdown", "md", "command", "documentation", "template"],
  ".css": ["style", "css"],
  ".scss": ["style", "scss", "css"],
  ".json": ["json", "package", "config"],
};

/** Convention section headers permitted when a plan is in fast-path mode. Anything
 *  outside this list is stripped from the per-task convention slice. */
export const FAST_PATH_WHITELIST = ["## Naming", "## Exports & Imports", "## Style", "## Error Handling", "## Patterns"];

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
 * Extract the set of file extensions (with leading dot) referenced in text.
 * Derives extensions from the same backtick-quoted refs as {@link extractFileRefs}.
 */
export function extractExtensions(text: string): Set<string> {
  const exts = new Set<string>();
  const refs = extractFileRefs(text);
  for (const ref of refs) {
    const extMatch = ref.match(/\.(\w{1,5})$/);
    if (extMatch) {
      exts.add(`.${extMatch[1]}`);
    }
  }
  return exts;
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

/**
 * Parse a CONVENTIONS.md document into `## ` delimited sections. Preamble
 * content appearing before the first header is returned with an empty header.
 */
export function parseConventionSections(conventionsText: string): ConventionSection[] {
  if (!conventionsText) return [];
  const sections: ConventionSection[] = [];
  const parts = conventionsText.split(/(?=^## )/m);
  for (const part of parts) {
    const headerMatch = part.match(/^## (.+)$/m);
    if (headerMatch) {
      sections.push({ header: headerMatch[1], content: part });
    } else if (part.trim()) {
      sections.push({ header: "", content: part });
    }
  }
  return sections;
}

/**
 * Heuristic: should the `## Testing` convention section be re-included for
 * this task? True when any referenced path looks like a test/spec file, or
 * when the task content (outside the `**Spec refs**:` line) mentions
 * test/spec by word.
 */
export function shouldIncludeTesting(taskContent: string, taskRefs: Set<string>): boolean {
  for (const ref of taskRefs) {
    if (/\.(test|spec)\.[tj]sx?$/i.test(ref)) return true;
  }
  const sanitized = taskContent.replace(/^\s*\*\*Spec refs\*\*:.*$/gmi, "");
  return /\btest\b|\bspec\b/i.test(sanitized);
}

/**
 * Parse the `Fast-path:` flag from the plan's `<classification>` block.
 * Returns `true` only when the line explicitly says `Fast-path: true`.
 */
export function parseFastPath(planContent: string): boolean {
  const classBlock = extractTagContent(planContent, "classification") || "";
  const match = classBlock.match(/^\s*Fast-path:\s*(true|false)\s*$/im);
  return match ? match[1].toLowerCase() === "true" : false;
}

/**
 * Return the list of convention section headers (each prefixed with `## `)
 * matching the task's referenced file extensions. When `planFastPath` is true,
 * the result is intersected with {@link FAST_PATH_WHITELIST} and restricted to
 * headers actually present in `sections`, matching the behavior of the inline
 * fast-path gate that lived in init-phase.ts.
 *
 * Callers pass pre-parsed sections so conventions are parsed once per phase,
 * not once per task.
 */
export function filterConventionsForTask(
  sections: ConventionSection[],
  taskExts: Set<string>,
  planFastPath?: boolean,
): string[] {
  if (sections.length === 0 || taskExts.size === 0) return [];

  let matched: string[] = [];

  for (const section of sections) {
    if (!section.header) {
      continue;
    }
    const headerLower = section.header.toLowerCase();
    const contentLower = section.content.toLowerCase();

    let sectionMatches = false;
    for (const ext of taskExts) {
      const keywords = EXT_KEYWORDS[ext] || [ext.slice(1)];
      for (const kw of keywords) {
        if (headerLower.includes(kw) || contentLower.includes(kw)) {
          sectionMatches = true;
          break;
        }
      }
      if (sectionMatches) break;
    }
    if (sectionMatches) {
      matched.push(`## ${section.header}`);
    }
  }

  if (planFastPath) {
    const presentHeaders = new Set(
      sections
        .map((s) => s.header)
        .filter(Boolean)
        .map((h) => `## ${h}`),
    );
    matched = FAST_PATH_WHITELIST.filter((h) => matched.includes(h) && presentHeaders.has(h));
  }

  return matched;
}
