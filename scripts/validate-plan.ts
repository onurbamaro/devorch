/**
 * validate-plan.ts — Validates plan structure (used as hook or standalone).
 * Usage: bun ~/.claude/devorch-scripts/validate-plan.ts --plan <path>
 * Output: JSON {"result":"continue"} or {"result":"block","reason":"..."}
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
    console.error("Usage: validate-plan.ts --plan <path>");
    process.exit(1);
  }
  return { plan };
}

const { plan: planPath } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.log(JSON.stringify({ result: "block", reason: `Could not read plan: ${planPath}` }));
  process.exit(0);
}

const errors: string[] = [];
const warnings: string[] = [];

// --- Required top-level sections ---
const requiredSections = [
  { pattern: /^#{1,2}\s+(Task Description|Description)/im, name: "Task Description" },
  { pattern: /^#{1,2}\s+Objective/im, name: "Objective" },
  { pattern: /^#{1,2}\s+Classification/im, name: "Classification" },
  { pattern: /^#{1,2}\s+Relevant Files/im, name: "Relevant Files" },
  { pattern: /^#{1,2}\s+Team Members/im, name: "Team Members" },
];

for (const { pattern, name } of requiredSections) {
  if (!pattern.test(content)) {
    errors.push(`Missing required section: ${name}`);
  }
}

// --- Classification validation ---
const classificationMatch = content.match(/## Classification[\s\S]*?(?=\n## )/);
if (classificationMatch) {
  const classBlock = classificationMatch[0];
  if (!/Type:\s*(feature|fix|refactor|migration|chore|enhancement)/i.test(classBlock)) {
    errors.push("Classification: missing or invalid Type");
  }
  if (!/Complexity:\s*(simple|medium|complex)/i.test(classBlock)) {
    errors.push("Classification: missing or invalid Complexity");
  }
  if (!/Risk:\s*(low|medium|high)/i.test(classBlock)) {
    errors.push("Classification: missing or invalid Risk");
  }
}

// --- Check conditional sections for medium/complex ---
const isComplex = /Complexity:\s*(medium|complex)/i.test(content);
if (isComplex) {
  if (!/^#{1,2}\s+Problem Statement/im.test(content)) {
    warnings.push("Medium/complex plan missing Problem Statement section");
  }
  if (!/^#{1,2}\s+Solution Approach/im.test(content)) {
    warnings.push("Medium/complex plan missing Solution Approach section");
  }
}

// --- Single pass: find phases with boundaries and validate ---
const lines = content.split("\n");
const phaseRegex = /^#{1,2}\s+Phase\s+(\d+)/i;

interface PhaseBounds {
  num: number;
  start: number;
  end: number;
}

const phases: PhaseBounds[] = [];

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
  errors.push("No phases found (expected ## Phase 1, ## Phase 2, ...)");
} else {
  // Validate sequential numbering
  for (let i = 0; i < phases.length; i++) {
    if (phases[i].num !== i + 1) {
      errors.push(`Phase numbering not sequential: expected Phase ${i + 1}, got Phase ${phases[i].num}`);
      break;
    }
  }

  // Per-phase validation using pre-computed boundaries
  for (const phase of phases) {
    const phaseContent = lines.slice(phase.start, phase.end).join("\n");

    const phaseRequired = [
      { pattern: /#{2,3}\s+(Goal|Objective)/i, name: "Goal" },
      { pattern: /#{2,3}\s+Tasks/i, name: "Tasks" },
      { pattern: /#{2,3}\s+Execution/i, name: "Execution" },
      { pattern: /#{2,3}\s+(Acceptance Criteria|Criteria)/i, name: "Acceptance Criteria" },
      { pattern: /#{2,3}\s+Validation Commands?/i, name: "Validation Commands" },
    ];

    for (const { pattern, name } of phaseRequired) {
      if (!pattern.test(phaseContent)) {
        errors.push(`Phase ${phase.num}: missing ${name} section`);
      }
    }

    if (/#{2,3}\s+Execution/i.test(phaseContent)) {
      if (!/\*\*Wave \d+\*\*/i.test(phaseContent)) {
        warnings.push(`Phase ${phase.num}: Execution section missing Wave definitions`);
      }
    }

    const taskBlocks = phaseContent.match(/####\s+\d+\./g);
    if (taskBlocks && taskBlocks.length > 0) {
      if (!/\*\*ID\*\*:/i.test(phaseContent)) {
        warnings.push(`Phase ${phase.num}: tasks missing ID metadata`);
      }
      if (!/\*\*Assigned To\*\*:/i.test(phaseContent)) {
        warnings.push(`Phase ${phase.num}: tasks missing Assigned To metadata`);
      }
    }

    if (phase.num < phases.length) {
      if (!/#{2,3}\s+Handoff/i.test(phaseContent)) {
        warnings.push(`Phase ${phase.num}: missing Handoff section`);
      }
    }
  }
}

// --- Output ---
if (errors.length === 0) {
  const result: { result: string; warnings?: string[] } = { result: "continue" };
  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  console.log(JSON.stringify(result));
} else {
  const reason = errors.join("; ");
  const result: { result: string; reason: string; warnings?: string[] } = { result: "block", reason };
  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  console.log(JSON.stringify(result));
}
