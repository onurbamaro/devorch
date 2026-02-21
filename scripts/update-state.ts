/**
 * update-state.ts — Deterministic state.md writer.
 * Usage: bun ~/.claude/devorch-scripts/update-state.ts --plan <path> --phase <N> --status <status> --summary <text> [--satellites '<json>']
 * Output: JSON {"stateFile", "planTitle", "phase"}
 * Writes .devorch/state.md only — no state-history.md.
 * With --satellites, includes satellite status in state.md.
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { readPlan, extractPlanTitle } from "./lib/plan-parser";

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

const planContent = readPlan(planPath);
const planTitle = extractPlanTitle(planContent);

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
  stateFile: ".devorch/state.md",
  planTitle,
  phase: phaseNum,
}));
