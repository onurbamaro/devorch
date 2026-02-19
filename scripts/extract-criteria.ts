/**
 * extract-criteria.ts — Extracts all acceptance criteria and validation commands from a plan.
 * Usage: bun ~/.claude/devorch-scripts/extract-criteria.ts --plan <path> [--tally]
 * Output: JSON with phases array, each containing criteria, validationCommands, and files.
 * With --tally: also includes tally fields (total, passed, perPhase).
 */
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { extractTagContent, parsePhaseBounds, readPlan, extractPlanTitle, extractFileEntries } from "./lib/plan-parser";
import { safeReadFile } from "./lib/fs-utils";

const args = parseArgs<{ plan: string; tally: boolean }>([
  { name: "plan", type: "string", required: true },
  { name: "tally", type: "boolean" },
]);

const planPath = args.plan;
const content = readPlan(planPath);
const phases = parsePhaseBounds(content);

// --- Extract plan-level info ---
const objective = extractTagContent(content, "objective") || "";

// --- Extract relevant files section ---
const relevantFilesBlock = extractTagContent(content, "relevant-files") || "";
const allRelevantFiles = extractFileEntries(relevantFilesBlock).map((f) => f.path);

// --- Extract new files subsection ---
const newFilesBlock = extractTagContent(content, "new-files") || "";
const newFiles = extractFileEntries(newFilesBlock).map((f) => f.path);

// --- Per-phase extraction ---
interface PhaseOutput {
  phase: number;
  name: string;
  goal: string;
  criteria: string[];
  validationCommands: { command: string; description: string }[];
}

const output: PhaseOutput[] = [];

for (const phase of phases) {
  const goal = extractTagContent(phase.content, "goal") || "";

  // Acceptance Criteria
  const criteriaContent = extractTagContent(phase.content, "criteria") || "";
  const criteriaLines = criteriaContent.split("\n").filter((l) => l.trim());
  const criteria = criteriaLines
    .filter((l) => /^[-*\[]/.test(l.trim()))
    .map((l) => l.trim().replace(/^[-*]\s*\[.\]\s*/, "").replace(/^[-*]\s*/, ""));

  // Validation Commands
  const validationContent = extractTagContent(phase.content, "validation") || "";
  const cmdLines = validationContent.split("\n").filter((l) => l.trim());
  const validationCommands: { command: string; description: string }[] = [];
  for (const line of cmdLines) {
    const cmdMatch = line.trim().match(/^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/);
    if (cmdMatch) {
      validationCommands.push({ command: cmdMatch[1], description: cmdMatch[2].trim() });
    }
  }

  output.push({
    phase: phase.phase,
    name: phase.name,
    goal,
    criteria,
    validationCommands,
  });
}

// --- Build result ---
const result: Record<string, unknown> = {
  objective,
  totalPhases: phases.length,
  relevantFiles: allRelevantFiles,
  newFiles,
  phases: output,
};

// --- Tally mode ---
if (args.tally) {
  const planDir = dirname(resolve(planPath));
  const stateFile = resolve(planDir, "..", "state.md");
  const stateContent = safeReadFile(stateFile);

  const phaseMatch = stateContent.match(/Last completed phase:\s*(\d+)/);
  const lastCompleted = phaseMatch ? parseInt(phaseMatch[1], 10) : 0;

  interface PhaseTally {
    phase: number;
    total: number;
    passed: number;
    status: string;
  }

  const perPhase: PhaseTally[] = output.map((p) => {
    const isCompleted = p.phase <= lastCompleted;
    return {
      phase: p.phase,
      total: p.criteria.length,
      passed: isCompleted ? p.criteria.length : 0,
      status: isCompleted ? "completed" : "pending",
    };
  });

  const total = perPhase.reduce((sum, p) => sum + p.total, 0);
  const passed = perPhase.reduce((sum, p) => sum + p.passed, 0);

  result.tally = { total, passed, perPhase };
}

console.log(JSON.stringify(result, null, 2));
