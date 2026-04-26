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

/**
 * Parse a GOTCHAS.md body into entries. Each line beginning with `- ` is treated
 * as one entry (matches the canonical "one-line gotcha" format from
 * commands/devorch.md § Gotcha capture). Header lines, blank lines, and other
 * scaffolding are returned alongside as `filler` so callers can preserve them
 * when reassembling content (e.g. for the legacy concatenated output).
 *
 * The optional `filePath` on each entry is the path component of the first
 * backtick-quoted token shaped like `path:line` or `path:line-line` found in
 * the entry. When absent, the entry is "global" and applies to every task.
 */
export interface GotchaEntry {
  /** The full original line text. */
  raw: string;
  /** Path portion of the first `path:line[-line]` backtick token, if any. */
  filePath?: string;
}

export function parseGotchaEntries(content: string): GotchaEntry[] {
  if (!content) return [];
  const entries: GotchaEntry[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (!/^\s*-\s+/.test(line)) continue;
    const match = line.match(/`([^`]+?):(\d+(?:-\d+)?)`/);
    const entry: GotchaEntry = { raw: line };
    if (match) {
      entry.filePath = match[1];
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Determine whether a gotcha entry's file path is in scope for a task. A task
 * with no refs receives only global (path-less) gotchas. An entry whose file
 * path begins with any of the task's refs (or vice-versa, to handle short
 * filename refs like `init-phase.ts` that should match longer paths like
 * `scripts/init-phase.ts`) is in scope.
 */
export function gotchaMatchesTask(entry: GotchaEntry, taskRefs: Set<string>): boolean {
  if (!entry.filePath) return true; // global
  for (const ref of taskRefs) {
    if (entry.filePath === ref) return true;
    if (entry.filePath.startsWith(ref + "/")) return true;
    if (entry.filePath.startsWith(ref)) return true;
    // Short filename ref (e.g. `init-phase.ts`) should still match a fuller path.
    if (ref.endsWith(entry.filePath)) return true;
    if (entry.filePath.endsWith("/" + ref) || entry.filePath.endsWith(ref)) {
      // tail-match on filename — covers tasks that mention bare filenames
      const tail = entry.filePath.split("/").pop() || "";
      if (tail === ref || ref.endsWith(tail)) return true;
    }
  }
  return false;
}

/**
 * Sanitize a single gotcha line. Returns the line unchanged when it is safe,
 * or `null` when the line should be dropped per the rules:
 *   (a) bare unbalanced closing tags (a line whose only non-whitespace content
 *       is a `</tag>` with no matching open in the same line) are dropped;
 *   (b) lines containing XML-like content with unbalanced tags are dropped.
 *
 * Pure mechanical: no judgment calls, just balance counting. Self-closing
 * (`<br/>`) and tags without attributes are recognised; tags with attributes
 * are tolerated. Tags inside backtick-quoted code spans are ignored —
 * `<placeholder>` inside `` `...` `` is inert markdown, not real XML, and
 * stripping legit gotchas that use `<X>` as a placeholder syntax would defeat
 * the purpose. Bare `<placeholder>` outside backticks (no closing tag in the
 * line at all) is also tolerated: there is no actual XML structure to
 * mis-parse, only a placeholder. Balance is only enforced when the line
 * actually contains at least one closing tag — that is the corruption shape
 * the rule targets (stray `</something>` from a prior bad write).
 */
export function sanitizeGotchaLine(line: string): string | null {
  // (a) Strip bare unbalanced closing tags: a line whose entire non-whitespace
  // content is `</tag>` (no other characters).
  const bareClose = line.match(/^\s*<\/([A-Za-z][\w-]*)>\s*$/);
  if (bareClose) return null;

  // Strip backtick-quoted code spans before tag scanning so that markdown
  // placeholders like `<branch>:<path>` are not counted.
  const stripped = line.replace(/`[^`]*`/g, "");

  // (b) Only enforce balance when the line has at least one closing tag.
  if (!/<\/[A-Za-z]/.test(stripped)) return line;

  // Tag scanner: walk through every <...> occurrence and tally open vs close
  // per tag name. Self-closing tags (`<br/>`) balance themselves.
  const counts = new Map<string, number>();
  const tagRegex = /<(\/?)([A-Za-z][\w-]*)(?:\s[^>]*)?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(stripped)) !== null) {
    const isClosing = m[1] === "/";
    const isSelfClose = m[3] === "/";
    const name = m[2];
    if (isSelfClose) continue;
    const cur = counts.get(name) ?? 0;
    counts.set(name, cur + (isClosing ? -1 : 1));
  }
  for (const v of counts.values()) {
    if (v !== 0) return null;
  }
  return line;
}

/**
 * Sanitize all entries from a parsed gotcha list. Returns the surviving entries
 * (each line passed through `sanitizeGotchaLine`).
 */
export function sanitizeGotchaEntries(entries: GotchaEntry[]): GotchaEntry[] {
  const out: GotchaEntry[] = [];
  for (const entry of entries) {
    const cleaned = sanitizeGotchaLine(entry.raw);
    if (cleaned === null) continue;
    out.push({ raw: cleaned, ...(entry.filePath ? { filePath: entry.filePath } : {}) });
  }
  return out;
}
