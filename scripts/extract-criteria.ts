/**
 * extract-criteria.ts — Extracts all acceptance criteria and validation commands from a plan.
 * Usage: bun ~/.claude/devorch-scripts/extract-criteria.ts --plan <path>
 * Output: JSON with phases array, each containing criteria, validationCommands, and files.
 */
import { readFileSync } from "fs";

function parseArgs(): { plan: string } {
  const args = process.argv.slice(2);
  let plan = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    }
  }
  if (!plan) {
    console.error("Usage: extract-criteria.ts --plan <path>");
    process.exit(1);
  }
  return { plan };
}

const { plan: planPath } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

const lines = content.split("\n");

// --- Helper: extract content from a named tag ---
function extractTagContent(text: string, tagName: string): string {
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

// --- Find phase boundaries ---
const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/i;
const phaseCloseRegex = /<\/phase(\d+)>/i;

interface PhaseBounds {
  num: number;
  name: string;
  start: number;
  end: number;
}

const phases: PhaseBounds[] = [];

for (let i = 0; i < lines.length; i++) {
  const openMatch = lines[i].match(phaseOpenRegex);
  if (openMatch) {
    phases.push({
      num: parseInt(openMatch[1], 10),
      name: openMatch[2],
      start: i,
      end: lines.length,
    });
  }
  const closeMatch = lines[i].match(phaseCloseRegex);
  if (closeMatch) {
    const closeNum = parseInt(closeMatch[1], 10);
    const phase = phases.find((p) => p.num === closeNum);
    if (phase) {
      phase.end = i + 1;
    }
  }
}

// --- Extract plan-level info ---
const objectiveMatch = content.match(/<objective>([\s\S]*?)<\/objective>/i);
const objective = objectiveMatch ? objectiveMatch[1].trim() : "";

// --- Extract relevant files section ---
const relevantFilesMatch = content.match(/<relevant-files>([\s\S]*?)<\/relevant-files>/i);
const allRelevantFiles: string[] = [];
if (relevantFilesMatch) {
  const fileLines = relevantFilesMatch[1].split("\n");
  for (const line of fileLines) {
    const fileMatch = line.match(/[-*]\s+`([^`]+)`/);
    if (fileMatch) {
      allRelevantFiles.push(fileMatch[1]);
    }
  }
}

// --- Extract new files subsection (nested inside relevant-files) ---
const newFilesMatch = content.match(/<new-files>([\s\S]*?)<\/new-files>/i);
const newFiles: string[] = [];
if (newFilesMatch) {
  const fileLines = newFilesMatch[1].split("\n");
  for (const line of fileLines) {
    const fileMatch = line.match(/[-*]\s+`([^`]+)`/);
    if (fileMatch) {
      newFiles.push(fileMatch[1]);
    }
  }
}

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
  const phaseContent = lines.slice(phase.start, phase.end).join("\n");

  // Goal
  const goal = extractTagContent(phaseContent, "goal");

  // Acceptance Criteria
  const criteriaContent = extractTagContent(phaseContent, "criteria");
  const criteriaLines = criteriaContent.split("\n").filter((l) => l.trim());
  const criteria = criteriaLines
    .filter((l) => /^[-*\[]/.test(l.trim()))
    .map((l) => l.trim().replace(/^[-*]\s*\[.\]\s*/, "").replace(/^[-*]\s*/, ""));

  // Validation Commands
  const validationContent = extractTagContent(phaseContent, "validation");
  const cmdLines = validationContent.split("\n").filter((l) => l.trim());
  const validationCommands: { command: string; description: string }[] = [];
  for (const line of cmdLines) {
    const cmdMatch = line.trim().match(/^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/);
    if (cmdMatch) {
      validationCommands.push({ command: cmdMatch[1], description: cmdMatch[2].trim() });
    }
  }

  output.push({
    phase: phase.num,
    name: phase.name,
    goal,
    criteria,
    validationCommands,
  });
}

console.log(
  JSON.stringify(
    {
      objective,
      totalPhases: phases.length,
      relevantFiles: allRelevantFiles,
      newFiles,
      phases: output,
    },
    null,
    2
  )
);
