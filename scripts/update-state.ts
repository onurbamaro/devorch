/**
 * update-state.ts — Deterministic state.md writer with state-history.md append.
 * Usage: bun ~/.claude/devorch-scripts/update-state.ts --plan <path> --phase <N> --status <status> --summary <text>
 * Output: JSON {"stateFile", "historyAppended", "planTitle", "phase"}
 * Writes .devorch/state.md and appends old phase summary to .devorch/state-history.md.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

function parseArgs(): { plan: string; phase: number; status: string; summary: string } {
  const args = process.argv.slice(2);
  let plan = "";
  let phase = 0;
  let status = "";
  let summary = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    } else if (args[i] === "--phase" && args[i + 1]) {
      phase = parseInt(args[++i], 10);
    } else if (args[i] === "--status" && args[i + 1]) {
      status = args[++i];
    } else if (args[i] === "--summary" && args[i + 1]) {
      summary = args[++i];
    }
  }

  if (!plan || !phase || !status || !summary) {
    console.error("Usage: update-state.ts --plan <path> --phase <N> --status <status> --summary <text>");
    process.exit(1);
  }

  return { plan, phase, status, summary };
}

const { plan: planPath, phase: phaseNum, status, summary } = parseArgs();

// --- Read plan title ---
let planContent: string;
try {
  planContent = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

const titleMatch = planContent.match(/^#\s+Plan:\s+(.+)$/m);
const planTitle = titleMatch ? titleMatch[1].trim() : "Untitled Plan";

// --- Resolve paths relative to plan directory ---
const planDir = dirname(resolve(planPath));
const projectRoot = resolve(planDir, "../..");
const stateFile = resolve(projectRoot, ".devorch/state.md");
const historyFile = resolve(projectRoot, ".devorch/state-history.md");

// --- Read existing state.md and archive old phase summary ---
let historyAppended = false;

if (existsSync(stateFile)) {
  try {
    const oldState = readFileSync(stateFile, "utf-8");
    const phaseSectionMatch = oldState.match(/(## Phase[\s\S]*)$/);
    if (phaseSectionMatch) {
      const phaseSection = phaseSectionMatch[1].trim();
      mkdirSync(dirname(historyFile), { recursive: true });
      if (existsSync(historyFile)) {
        appendFileSync(historyFile, "\n\n" + phaseSection, "utf-8");
      } else {
        writeFileSync(historyFile, phaseSection, "utf-8");
      }
      historyAppended = true;
    }
  } catch {
    // ignore — proceed with fresh state
  }
}

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
  historyAppended,
  planTitle,
  phase: phaseNum,
}));
