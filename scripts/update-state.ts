/**
 * update-state.ts — Deterministic state.md writer.
 * Usage: bun ~/.claude/devorch-scripts/update-state.ts --plan <path> --phase <N> --status <status> --summary <text>
 * Output: JSON {"stateFile", "planTitle", "phase"}
 * Writes .devorch/state.md only — no state-history.md.
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { readPlan, extractPlanTitle } from "./lib/plan-parser";

const args = parseArgs<{ plan: string; phase: number; status: string; summary: string }>([
  { name: "plan", type: "string", required: true },
  { name: "phase", type: "number", required: true },
  { name: "status", type: "string", required: true },
  { name: "summary", type: "string", required: true },
]);

const planPath = args.plan;
const phaseNum = args.phase;
const status = args.status;
const summary = args.summary;

const planContent = readPlan(planPath);
const planTitle = extractPlanTitle(planContent);

// --- Resolve paths relative to plan directory ---
const planDir = dirname(resolve(planPath));
const projectRoot = resolve(planDir, "../..");
const stateFile = resolve(projectRoot, ".devorch/state.md");

// --- Write new state.md ---
const stateContent = `# devorch State
- Plan: ${planTitle}
- Last completed phase: ${phaseNum}
- Status: ${status}

## Phase ${phaseNum} Summary
${summary}
`;

mkdirSync(dirname(stateFile), { recursive: true });
writeFileSync(stateFile, stateContent, "utf-8");

// --- Output ---
console.log(JSON.stringify({
  stateFile: ".devorch/state.md",
  planTitle,
  phase: phaseNum,
}));
