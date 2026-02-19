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
