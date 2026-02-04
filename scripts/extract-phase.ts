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

// --- Single pass: find all phase boundaries ---
interface PhaseBounds {
  num: number;
  start: number;
  end: number;
}

const phases: PhaseBounds[] = [];
const phaseRegex = /^#{1,2}\s+Phase\s+(\d+)/i;

for (let i = 0; i < lines.length; i++) {
  const match = lines[i].match(phaseRegex);
  if (match) {
    if (phases.length > 0) {
      phases[phases.length - 1].end = i;
    }
    phases.push({ num: parseInt(match[1], 10), start: i, end: lines.length });
  }
}

if (phases.length === 0) {
  // No phase headings found — output entire plan
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
    const prevLines = lines.slice(prevPhase.start, prevPhase.end);
    const handoffIdx = prevLines.findIndex((l) => /^#{2,3}\s+(Handoff|Output|Deliverables)/i.test(l));
    if (handoffIdx !== -1) {
      output.push("---");
      output.push("");
      output.push(`# Handoff from Phase ${phaseNum - 1}`);
      output.push("");
      let endIdx = prevLines.length;
      for (let i = handoffIdx + 1; i < prevLines.length; i++) {
        if (/^#{2,3}\s+/.test(prevLines[i])) {
          endIdx = i;
          break;
        }
      }
      output.push(...prevLines.slice(handoffIdx, endIdx));
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
