/**
 * format-commit.ts — Generates a deterministic phase commit message from plan goal.
 * Usage: bun ~/.claude/devorch-scripts/format-commit.ts --plan <path> --phase <N>
 * Output: JSON {"message", "phase", "goal"}
 */
import { readFileSync } from "fs";

const MAX_GOAL_LENGTH = 50;

interface PhaseBounds {
  num: number;
  name: string;
  start: number;
  end: number;
}

function parseArgs(): { plan: string; phase: number } {
  const args = process.argv.slice(2);
  let plan = "";
  let phase = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    } else if (args[i] === "--phase" && args[i + 1]) {
      phase = parseInt(args[++i], 10);
    }
  }
  if (!plan || !phase) {
    console.error("Usage: format-commit.ts --plan <path> --phase <N>");
    process.exit(1);
  }
  return { plan, phase };
}

function extractTagContent(text: string, tagName: string): string {
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

const { plan: planPath, phase: phaseNum } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

// Find phase boundaries
const lines = content.split("\n");
const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/i;
const phaseCloseRegex = /<\/phase(\d+)>/i;
const phases: PhaseBounds[] = [];

for (let i = 0; i < lines.length; i++) {
  const openMatch = lines[i].match(phaseOpenRegex);
  if (openMatch) {
    phases.push({ num: parseInt(openMatch[1], 10), name: openMatch[2], start: i, end: lines.length });
  }
  const closeMatch = lines[i].match(phaseCloseRegex);
  if (closeMatch) {
    const closeNum = parseInt(closeMatch[1], 10);
    const phase = phases.find((p) => p.num === closeNum);
    if (phase) { phase.end = i + 1; }
  }
}

const target = phases.find((p) => p.num === phaseNum);
if (!target) {
  console.error(`Phase ${phaseNum} not found. Available: ${phases.map((p) => p.num).join(", ")}`);
  process.exit(1);
}

const phaseContent = lines.slice(target.start, target.end).join("\n");
const goal = extractTagContent(phaseContent, "goal");

if (!goal) {
  console.error(`Phase ${phaseNum}: no <goal> tag found.`);
  process.exit(1);
}

// Truncate goal
const truncatedGoal = goal.length > MAX_GOAL_LENGTH
  ? goal.substring(0, MAX_GOAL_LENGTH) + "..."
  : goal;

const message = `phase(${phaseNum}): ${truncatedGoal}`;

console.log(JSON.stringify({ message, phase: phaseNum, goal }));
