/**
 * phase-summary.ts — Generates phase commit message AND writes cache/state.json in one call.
 * Usage: bun ~/.claude/devorch-scripts/phase-summary.ts --plan <path> --phase <N> --status <text> --summary <text> [--satellites '<json>']
 * Output: JSON {"message", "phase", "goal", "stateFile", "planTitle"}
 *
 * State file shape (.devorch/cache/state.json):
 *   { status: string, lastPhase: number, lastPhaseSummary: string, updatedAt: string }
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { readPlan, extractPlanTitle, parsePhaseBounds, extractTagContent } from "./lib/plan-parser";

interface DevorchState {
  status: string;
  lastPhase: number;
  lastPhaseSummary: string;
  updatedAt: string;
}

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
const stateFile = resolve(projectRoot, ".devorch/cache/state.json");

// --- Compose state summary text (includes satellites when provided) ---
let lastPhaseSummary = summary;
if (satelliteEntries.length > 0) {
  const satelliteLines = satelliteEntries.map((s) => `- ${s.name}: ${s.status}`).join("\n");
  lastPhaseSummary = `${summary}\n\nSatellites:\n${satelliteLines}`;
}

// --- Write new cache/state.json ---
const state: DevorchState = {
  status,
  lastPhase: phaseNum,
  lastPhaseSummary,
  updatedAt: new Date().toISOString(),
};

mkdirSync(dirname(stateFile), { recursive: true });
writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", "utf-8");

// --- Output ---
console.log(JSON.stringify({
  message,
  phase: phaseNum,
  goal,
  stateFile: ".devorch/cache/state.json",
  planTitle,
}));
