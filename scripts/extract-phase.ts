/**
 * extract-phase.ts — Extracts 1 phase from a plan + minimal context.
 * Usage: bun ~/.claude/devorch-scripts/extract-phase.ts --plan <path> --phase <N>
 * Output: Markdown with plan header + handoff from N-1 + phase N
 * Saves ~30-40% tokens vs loading full plan.
 */
import { readFileSync } from "fs";

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
    console.error("Usage: extract-phase.ts --plan <path> --phase <N>");
    process.exit(1);
  }

  return { plan, phase };
}

const { plan: planPath, phase: phaseNum } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

const lines = content.split("\n");
const output: string[] = [];

// --- Single pass: find all phase boundaries using tags ---
const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/i;
const phaseCloseRegex = /<\/phase(\d+)>/i;

interface PhaseBounds {
  num: number;
  name: string;
  start: number;
  end: number; // line index of closing tag
}

const phases: PhaseBounds[] = [];

for (let i = 0; i < lines.length; i++) {
  const openMatch = lines[i].match(phaseOpenRegex);
  if (openMatch) {
    phases.push({
      num: parseInt(openMatch[1], 10),
      name: openMatch[2],
      start: i,
      end: lines.length, // default, updated when close tag found
    });
  }
  const closeMatch = lines[i].match(phaseCloseRegex);
  if (closeMatch) {
    const closeNum = parseInt(closeMatch[1], 10);
    const phase = phases.find((p) => p.num === closeNum);
    if (phase) {
      phase.end = i + 1; // include the closing tag line
    }
  }
}

if (phases.length === 0) {
  // No phase tags found — output entire plan
  console.log(content);
  process.exit(0);
}

// Header: everything before first phase
output.push("# Plan Context");
output.push("");
output.push(...lines.slice(0, phases[0].start).filter((l) => l.trim() !== ""));
output.push("");

// --- Extract handoff from N-1 ---
if (phaseNum > 1) {
  const prevPhase = phases.find((p) => p.num === phaseNum - 1);
  if (prevPhase) {
    const prevContent = lines.slice(prevPhase.start, prevPhase.end).join("\n");
    const handoffMatch = prevContent.match(/<handoff>([\s\S]*?)<\/handoff>/i);
    if (handoffMatch) {
      output.push("---");
      output.push("");
      output.push(`# Handoff from Phase ${phaseNum - 1}`);
      output.push("");
      output.push(handoffMatch[1].trim());
      output.push("");
    }
  }
}

// --- Extract phase N ---
const targetPhase = phases.find((p) => p.num === phaseNum);
if (!targetPhase) {
  console.error(`Phase ${phaseNum} not found in plan. Available: ${phases.map((p) => p.num).join(", ")}`);
  process.exit(1);
}

output.push("---");
output.push("");
output.push(...lines.slice(targetPhase.start, targetPhase.end));

// --- Summary ---
output.push("");
output.push("---");
output.push(`*Extracted phase ${phaseNum} of ${phases.length} total phases*`);

console.log(output.join("\n"));
