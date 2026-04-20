/**
 * plan-parser.ts — Shared library for plan file parsing.
 * Canonical implementations of extractTagContent, parsePhaseBounds, readPlan, extractPlanTitle, extractFileEntries.
 */
import { readFileSync } from "fs";

export interface PhaseBounds {
  phase: number;
  name: string;
  start: number;
  end: number;
  content: string;
}

export function extractTagContent(text: string, tagName: string): string | null {
  // Opening tag anchored to line start (avoids false matches on backtick-quoted tags).
  // Closing tag not anchored — supports both single-line and multi-line content.
  const match = text.match(new RegExp(`^\\s*<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "im"));
  return match ? match[1].trim() : null;
}

export function parsePhaseBounds(planContent: string): PhaseBounds[] {
  const lines = planContent.split("\n");
  const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/i;
  const phaseCloseRegex = /<\/phase(\d+)>/i;

  const phases: PhaseBounds[] = [];

  for (let i = 0; i < lines.length; i++) {
    const openMatch = lines[i].match(phaseOpenRegex);
    if (openMatch) {
      phases.push({
        phase: parseInt(openMatch[1], 10),
        name: openMatch[2],
        start: i,
        end: lines.length,
        content: "",
      });
    }
    const closeMatch = lines[i].match(phaseCloseRegex);
    if (closeMatch) {
      const closeNum = parseInt(closeMatch[1], 10);
      const found = phases.find((p) => p.phase === closeNum);
      if (found) {
        found.end = i + 1;
      }
    }
  }

  for (const p of phases) {
    p.content = lines.slice(p.start, p.end).join("\n");
  }

  phases.sort((a, b) => a.phase - b.phase);
  return phases;
}

export function readPlan(planPath: string): string {
  try {
    return readFileSync(planPath, "utf-8");
  } catch {
    console.error(`Could not read plan: ${planPath}`);
    process.exit(1);
  }
}

export function extractPlanTitle(planContent: string): string {
  const match = planContent.match(/^#\s+Plan:\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled Plan";
}

export function extractFileEntries(block: string): Array<{ path: string; description: string }> {
  const entries: Array<{ path: string; description: string }> = [];
  const lineRegex = /^-\s+`([^`]+)`\s+—\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(block)) !== null) {
    entries.push({ path: match[1], description: match[2].trim() });
  }

  return entries;
}

export interface SecondaryRepo {
  name: string;
  path: string;
}

// --- Spec parsing ---

export type SpecType = "interface" | "error-contract" | "behavior" | "invariant" | "endpoint" | "entity";

export function extractPhaseSpec(phaseContent: string): string | null {
  const match = phaseContent.match(/<spec>([\s\S]*?)<\/spec>/i);
  return match ? match[1].trim() || null : null;
}

export function parseSpecNames(specContent: string): string[] {
  const names: string[] = [];

  // Named tags: interface, error-contract, behavior, entity — extract name="..."
  const namedTagRegex = /<(?:interface|error-contract|behavior|entity)\s+[^>]*name="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = namedTagRegex.exec(specContent)) !== null) {
    names.push(m[1]);
  }

  // Invariant tags — accept both explicit name="..." and implicit ordinal (invariant-N)
  const invariantRegex = /<invariant(\s[^>]*)?>[\s\S]*?<\/invariant>/gi;
  let invIdx = 0;
  while ((m = invariantRegex.exec(specContent)) !== null) {
    invIdx++;
    names.push(`invariant-${invIdx}`);
    const attrs = m[1] || "";
    const nameMatch = attrs.match(/name="([^"]+)"/);
    if (nameMatch) names.push(nameMatch[1]);
  }

  // Endpoint tags — implicit naming: METHOD-/path
  const endpointRegex = /<endpoint\s+[^>]*(?:method="([^"]+)"[^>]*path="([^"]+)"|path="([^"]+)"[^>]*method="([^"]+)")[^>]*>/gi;
  while ((m = endpointRegex.exec(specContent)) !== null) {
    const method = (m[1] || m[4]).toUpperCase();
    const path = m[2] || m[3];
    names.push(`${method}-${path}`);
  }

  // Deduplicate while preserving order
  return [...new Set(names)];
}

export function filterSpecsByRefs(specContent: string, refs: string[]): string {
  const refsSet = new Set(refs);
  const matched: string[] = [];

  // Named tags: interface, error-contract, behavior, entity
  const namedRegex = /<(interface|error-contract|behavior|entity)\s+[^>]*name="([^"]+)"[^>]*>[\s\S]*?<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = namedRegex.exec(specContent)) !== null) {
    if (refsSet.has(m[2])) {
      matched.push(m[0]);
    }
  }

  // Invariant tags — match by explicit name="..." OR implicit ordinal (invariant-N)
  const invariantRegex = /<invariant(\s[^>]*)?>[\s\S]*?<\/invariant>/gi;
  let invIdx = 0;
  while ((m = invariantRegex.exec(specContent)) !== null) {
    invIdx++;
    const attrs = m[1] || "";
    const nameMatch = attrs.match(/name="([^"]+)"/);
    if (refsSet.has(`invariant-${invIdx}`) || (nameMatch && refsSet.has(nameMatch[1]))) {
      matched.push(m[0]);
    }
  }

  // Endpoint tags with implicit names
  const endpointRegex = /<endpoint\s+[^>]*(?:method="([^"]+)"[^>]*path="([^"]+)"|path="([^"]+)"[^>]*method="([^"]+)")[^>]*>[\s\S]*?<\/endpoint>/gi;
  while ((m = endpointRegex.exec(specContent)) !== null) {
    const method = (m[1] || m[4]).toUpperCase();
    const path = m[2] || m[3];
    if (refsSet.has(`${method}-${path}`)) {
      matched.push(m[0]);
    }
  }

  return matched.join("\n");
}

export function extractExploreQueries(phaseContent: string): Array<{ query: string; taskId: string }> {
  const block = extractTagContent(phaseContent, "explore-queries");
  if (!block) return [];

  const results: Array<{ query: string; taskId: string }> = [];
  const lineRegex = /^-\s+"(.+?)"\s+[—\-]{1,2}\s+for task\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(block)) !== null) {
    results.push({ query: match[1], taskId: match[2].trim() });
  }

  return results;
}

export function extractSecondaryRepos(planContent: string): SecondaryRepo[] {
  const block = extractTagContent(planContent, "secondary-repos");
  if (!block) return [];

  const repos: SecondaryRepo[] = [];
  const lineRegex = /^-\s+`([^`]+)`\s+—\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(block)) !== null) {
    repos.push({ name: match[1], path: match[2].trim() });
  }

  return repos;
}
