/**
 * phase-summary.ts — Generates phase commit message AND writes state.md in one call.
 * Combines logic from format-commit.ts and update-state.ts.
 * Usage: bun ~/.claude/devorch-scripts/phase-summary.ts --plan <path> --phase <N> --status <text> --summary <text> [--satellites '<json>']
 * Output: JSON {"message", "phase", "goal", "stateFile", "planTitle"}
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { readPlan, extractPlanTitle, parsePhaseBounds, extractTagContent } from "./lib/plan-parser";

const MAX_GOAL_LENGTH = 50;

const args = parseArgs<{ plan: string; phase: number; status: string; summary: string; satellites: string }>([
  { name: "plan", type: "string", required: true },
  { name: "phase", type: "number", required: true },
  { name: "status", type: "string", required: true },
  { name: "summary", type: "string", required: true },
  { name: "satellites", type: "string", required: false },
]);

const planPath = args.plan;
const phaseNum = args.phase;
const status = args.status;
const summary = args.summary;

// --- Extract plan title and phase goal ---
const planContent = readPlan(planPath);
const planTitle = extractPlanTitle(planContent);

const phases = parsePhaseBounds(planContent);
const target = phases.find((p) => p.phase === phaseNum);
if (!target) {
  console.error(`Phase ${phaseNum} not found. Available: ${phases.map((p) => p.phase).join(", ")}`);
  process.exit(1);
}

const goal = extractTagContent(target.content, "goal") || "";
if (!goal) {
  console.error(`Phase ${phaseNum}: no <goal> tag found.`);
  process.exit(1);
}

// --- Generate commit message ---
const truncatedGoal = goal.length > MAX_GOAL_LENGTH
  ? goal.substring(0, MAX_GOAL_LENGTH) + "..."
  : goal;

const message = `phase(${phaseNum}): ${truncatedGoal}`;

// --- Parse satellite status ---
interface SatelliteStatus {
  name: string;
  status: string;
}

let satelliteEntries: SatelliteStatus[] = [];
if (args.satellites) {
  try {
    const parsed = JSON.parse(args.satellites);
    if (Array.isArray(parsed)) {
      satelliteEntries = parsed;
    } else {
      console.error("--satellites must be a JSON array");
    }
  } catch {
    console.error("Failed to parse --satellites JSON");
  }
}

// --- Resolve paths relative to plan directory ---
const planDir = dirname(resolve(planPath));
const projectRoot = resolve(planDir, "../..");
const stateFile = resolve(projectRoot, ".devorch/state.md");

// --- Build satellite section ---
let satelliteSection = "";
if (satelliteEntries.length > 0) {
  const lines = satelliteEntries.map((s) => `- ${s.name}: ${s.status}`);
  satelliteSection = `\n## Satellites\n${lines.join("\n")}\n`;
}

// --- Write new state.md ---
const stateContent = `# devorch State
- Plan: ${planTitle}
- Last completed phase: ${phaseNum}
- Status: ${status}

## Phase ${phaseNum} Summary
${summary}
${satelliteSection}`;

mkdirSync(dirname(stateFile), { recursive: true });
writeFileSync(stateFile, stateContent, "utf-8");

// --- Output ---
console.log(JSON.stringify({
  message,
  phase: phaseNum,
  goal,
  stateFile: ".devorch/state.md",
  planTitle,
}));
