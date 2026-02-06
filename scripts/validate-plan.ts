/**
 * validate-plan.ts — Validates plan structure (used as hook or standalone).
 * Usage: bun ~/.claude/devorch-scripts/validate-plan.ts --plan <path>
 * Output: JSON {"result":"continue"} or {"result":"block","reason":"..."}
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";

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

// --- Required top-level tags ---
const requiredTags = [
  { pattern: /<description>[\s\S]*?<\/description>/i, name: "description" },
  { pattern: /<objective>[\s\S]*?<\/objective>/i, name: "objective" },
  { pattern: /<classification>[\s\S]*?<\/classification>/i, name: "classification" },
  { pattern: /<relevant-files>[\s\S]*?<\/relevant-files>/i, name: "relevant-files" },
];

for (const { pattern, name } of requiredTags) {
  if (!pattern.test(content)) {
    errors.push(`Missing required section: ${name}`);
  }
}

// --- Classification validation ---
const classificationMatch = content.match(/<classification>([\s\S]*?)<\/classification>/i);
if (classificationMatch) {
  const classBlock = classificationMatch[1];
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
  if (!/<problem-statement>[\s\S]*?<\/problem-statement>/i.test(content)) {
    warnings.push("Medium/complex plan missing <problem-statement> section");
  }
  if (!/<solution-approach>[\s\S]*?<\/solution-approach>/i.test(content)) {
    warnings.push("Medium/complex plan missing <solution-approach> section");
  }
}

// --- Phase detection using open/close tags ---
interface PhaseBounds {
  num: number;
  name: string;
  content: string;
}

const phases: PhaseBounds[] = [];
const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/gi;
let phaseMatch: RegExpExecArray | null;

while ((phaseMatch = phaseOpenRegex.exec(content)) !== null) {
  const num = parseInt(phaseMatch[1], 10);
  const name = phaseMatch[2];
  const openEnd = phaseMatch.index + phaseMatch[0].length;
  const closeTag = new RegExp(`<\\/phase${num}>`, "i");
  const closeMatch = closeTag.exec(content.slice(openEnd));

  if (closeMatch) {
    const phaseContent = content.slice(openEnd, openEnd + closeMatch.index);
    phases.push({ num, name, content: phaseContent });
  } else {
    errors.push(`Phase ${num}: missing closing </phase${num}> tag`);
  }
}

if (phases.length === 0) {
  errors.push('No phases found (expected <phase1 name="...">...</phase1>, <phase2 name="...">..., etc.)');
} else {
  // Validate sequential numbering
  for (let i = 0; i < phases.length; i++) {
    if (phases[i].num !== i + 1) {
      errors.push(`Phase numbering not sequential: expected Phase ${i + 1}, got Phase ${phases[i].num}`);
      break;
    }
  }

  // Per-phase validation
  for (const phase of phases) {
    const phaseContent = phase.content;

    const phaseRequired = [
      { pattern: /<goal>[\s\S]*?<\/goal>/i, name: "goal" },
      { pattern: /<tasks>[\s\S]*?<\/tasks>/i, name: "tasks" },
      { pattern: /<execution>[\s\S]*?<\/execution>/i, name: "execution" },
      { pattern: /<criteria>[\s\S]*?<\/criteria>/i, name: "criteria" },
      { pattern: /<validation>[\s\S]*?<\/validation>/i, name: "validation" },
    ];

    for (const { pattern, name } of phaseRequired) {
      if (!pattern.test(phaseContent)) {
        errors.push(`Phase ${phase.num}: missing ${name} section`);
      }
    }

    // Execution wave check
    const executionMatch = phaseContent.match(/<execution>([\s\S]*?)<\/execution>/i);
    if (executionMatch) {
      if (!/\*\*Wave \d+\*\*/i.test(executionMatch[1])) {
        warnings.push(`Phase ${phase.num}: Execution section missing Wave definitions`);
      }
    }

    // Task metadata checks — extract tasks content
    const tasksMatch = phaseContent.match(/<tasks>([\s\S]*?)<\/tasks>/i);
    const tasksContent = tasksMatch ? tasksMatch[1] : "";

    const taskBlocks = tasksContent.match(/####\s+\d+\./g);
    if (taskBlocks && taskBlocks.length > 0) {
      if (!/\*\*ID\*\*:/i.test(tasksContent)) {
        warnings.push(`Phase ${phase.num}: tasks missing ID metadata`);
      }
      if (!/\*\*Assigned To\*\*:/i.test(tasksContent)) {
        warnings.push(`Phase ${phase.num}: tasks missing Assigned To metadata`);
      }
    }

    // Optional <test-contract> — if present, must have content
    const testContractMatch = phaseContent.match(/<test-contract>([\s\S]*?)<\/test-contract>/i);
    if (testContractMatch && !testContractMatch[1].trim()) {
      warnings.push(`Phase ${phase.num}: <test-contract> tag is empty`);
    }

    // Handoff — required except last phase
    if (phase.num < phases.length) {
      if (!/<handoff>[\s\S]*?<\/handoff>/i.test(phaseContent)) {
        warnings.push(`Phase ${phase.num}: missing <handoff> section`);
      }
    }

    // --- Wave conflict detection ---
    // Extract tasks with their IDs and file references from <tasks> content
    interface TaskInfo {
      id: string;
      files: string[];
    }

    const tasks: TaskInfo[] = [];
    const taskSections = tasksContent.split(/####\s+\d+\.\s+/);

    for (const section of taskSections.slice(1)) {
      const idMatch = section.match(/\*\*ID\*\*:\s*(\S+)/i);
      if (!idMatch) continue;

      const taskId = idMatch[1];
      // Extract file paths from backtick references
      const fileRefs = [...section.matchAll(/`([^`]*(?:\/[^`]+|\.\w{1,5}))`/g)]
        .map((m) => m[1])
        .filter((f) => /\.\w{1,5}$/.test(f)); // only paths with extensions

      tasks.push({ id: taskId, files: fileRefs });
    }

    // Extract wave definitions from <execution> content and check for file conflicts
    const executionContent = executionMatch ? executionMatch[1] : "";
    const waveRegex = /\*\*Wave\s+(\d+)\*\*[^:]*:\s*(.+)/gi;
    const waveMatches = [...executionContent.matchAll(waveRegex)];

    for (const waveMatch of waveMatches) {
      const waveNum = waveMatch[1];
      const taskIds = waveMatch[2]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      // Check that referenced task IDs exist
      for (const tid of taskIds) {
        if (tid.startsWith("validate")) continue; // validator tasks are implicit
        if (!tasks.some((t) => t.id === tid)) {
          warnings.push(
            `Phase ${phase.num}: Wave ${waveNum} references unknown task ID "${tid}"`
          );
        }
      }

      // Check for file overlaps within the same wave
      const waveTasks = tasks.filter((t) => taskIds.includes(t.id));
      for (let a = 0; a < waveTasks.length; a++) {
        for (let b = a + 1; b < waveTasks.length; b++) {
          const overlap = waveTasks[a].files.filter((f) =>
            waveTasks[b].files.includes(f)
          );
          if (overlap.length > 0) {
            warnings.push(
              `Phase ${phase.num}: Wave ${waveNum} conflict — tasks "${waveTasks[a].id}" and "${waveTasks[b].id}" both touch: ${overlap.join(", ")}`
            );
          }
        }
      }
    }
  }
}

// --- Output ---
if (errors.length === 0) {
  // Compute hash excluding any existing validated comment
  const cleanContent = content.replace(/<!-- Validated: [a-f0-9]{64} -->\n?/, "");
  const hash = createHash("sha256").update(cleanContent).digest("hex");

  const result: { result: string; hash: string; warnings?: string[] } = { result: "continue", hash };
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
