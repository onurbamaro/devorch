/**
 * tally-criteria.ts — Deterministic criteria tally from plan + state.
 * Usage: bun ~/.claude/devorch-scripts/tally-criteria.ts --plan <path>
 * Output: JSON with per-phase tallies and overall verdict.
 * Logic: completed phase = all criteria pass (guaranteed by validator gate in build-phase).
 */
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";

function parseArgs(): { plan: string } {
  const args = process.argv.slice(2);
  let plan = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    }
  }
  if (!plan) {
    console.error("Usage: tally-criteria.ts --plan <path>");
    process.exit(1);
  }
  return { plan };
}

interface PhaseTally {
  phase: number;
  name: string;
  total: number;
  passed: number;
  status: "completed" | "pending" | "unknown";
}

// --- Extract criteria from plan (same logic as extract-criteria.ts) ---

function extractTagContent(text: string, tagName: string): string {
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

function extractPhaseCriteria(planContent: string): { num: number; name: string; criteria: string[] }[] {
  const lines = planContent.split("\n");
  const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/i;
  const phaseCloseRegex = /<\/phase(\d+)>/i;

  const bounds: { num: number; name: string; start: number; end: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const openMatch = lines[i].match(phaseOpenRegex);
    if (openMatch) {
      bounds.push({
        num: parseInt(openMatch[1], 10),
        name: openMatch[2],
        start: i,
        end: lines.length,
      });
    }
    const closeMatch = lines[i].match(phaseCloseRegex);
    if (closeMatch) {
      const closeNum = parseInt(closeMatch[1], 10);
      const phase = bounds.find((p) => p.num === closeNum);
      if (phase) phase.end = i + 1;
    }
  }

  return bounds.map((phase) => {
    const phaseContent = lines.slice(phase.start, phase.end).join("\n");
    const criteriaContent = extractTagContent(phaseContent, "criteria");
    const criteria = criteriaContent
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => /^[-*\[]/.test(l.trim()))
      .map((l) => l.trim().replace(/^[-*]\s*\[.\]\s*/, "").replace(/^[-*]\s*/, ""));
    return { num: phase.num, name: phase.name, criteria };
  });
}

// --- Read state.md to determine completed phases ---

function readCompletedPhase(planPath: string): { lastCompleted: number; status: string } {
  const planDir = dirname(resolve(planPath));
  const stateFile = resolve(planDir, "..", "state.md");

  if (!existsSync(stateFile)) {
    return { lastCompleted: 0, status: "no state" };
  }

  const content = readFileSync(stateFile, "utf-8");
  const phaseMatch = content.match(/Last completed phase:\s*(\d+)/);
  const statusMatch = content.match(/Status:\s*(.+)/);

  return {
    lastCompleted: phaseMatch ? parseInt(phaseMatch[1], 10) : 0,
    status: statusMatch ? statusMatch[1].trim() : "unknown",
  };
}

// --- Main ---

const { plan: planPath } = parseArgs();

let planContent: string;
try {
  planContent = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

const phaseCriteria = extractPhaseCriteria(planContent);
const { lastCompleted, status } = readCompletedPhase(planPath);

const phases: PhaseTally[] = phaseCriteria.map((p) => {
  const isCompleted = p.num <= lastCompleted;
  return {
    phase: p.num,
    name: p.name,
    total: p.criteria.length,
    passed: isCompleted ? p.criteria.length : 0,
    status: isCompleted ? "completed" : "pending",
  };
});

const totalCriteria = phases.reduce((sum, p) => sum + p.total, 0);
const passedCriteria = phases.reduce((sum, p) => sum + p.passed, 0);
const allComplete = status === "completed" || lastCompleted >= phaseCriteria.length;
const verdict = allComplete && passedCriteria === totalCriteria ? "PASS" : "FAIL";

console.log(
  JSON.stringify(
    {
      totalCriteria,
      passedCriteria,
      verdict,
      phases,
    },
    null,
    2
  )
);
