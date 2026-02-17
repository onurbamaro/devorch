/**
 * extract-waves.ts — Parses execution block from plan phase into structured wave/task JSON.
 * Usage: bun ~/.claude/devorch-scripts/extract-waves.ts --plan <path> --phase <N>
 * Output: JSON with waves array and tasks map.
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
    console.error("Usage: extract-waves.ts --plan <path> --phase <N>");
    process.exit(1);
  }

  return { plan, phase };
}

function extractTagContent(text: string, tagName: string): string {
  // Match tags at line start (after optional whitespace) to skip inline backtick references
  const match = text.match(new RegExp(`^\\s*<${tagName}>([\\s\\S]*?)^\\s*<\\/${tagName}>`, "im"));
  return match ? match[1].trim() : "";
}

interface PhaseBounds {
  num: number;
  name: string;
  start: number;
  end: number;
}

interface WaveInfo {
  wave: number;
  taskIds: string[];
  type: "parallel" | "sequential" | "validation";
}

interface TaskInfo {
  id: string;
  assignedTo: string;
  title: string;
  content: string;
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

// --- Find phase boundaries ---
const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/i;
const phaseCloseRegex = /<\/phase(\d+)>/i;

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

const targetPhase = phases.find((p) => p.num === phaseNum);
if (!targetPhase) {
  console.error(`Phase ${phaseNum} not found. Available: ${phases.map((p) => p.num).join(", ")}`);
  process.exit(1);
}

const phaseContent = lines.slice(targetPhase.start, targetPhase.end).join("\n");

// --- Extract execution block ---
const executionContent = extractTagContent(phaseContent, "execution");
if (!executionContent) {
  console.error(`Phase ${phaseNum}: no <execution> block found.`);
  process.exit(1);
}

// --- Parse waves ---
const waves: WaveInfo[] = [];
const waveRegex = /\*\*Wave\s+(\d+)\*\*\s*(?:\(([^)]*)\))?\s*:\s*(.+)/gi;
let waveMatch: RegExpExecArray | null;

while ((waveMatch = waveRegex.exec(executionContent)) !== null) {
  const waveNum = parseInt(waveMatch[1], 10);
  const annotation = (waveMatch[2] || "").trim().toLowerCase();
  const taskIdStr = waveMatch[3];

  // Determine type from annotation
  let type: "parallel" | "sequential" | "validation" = "parallel";
  if (annotation === "validation") {
    type = "validation";
  } else if (annotation === "sequential" || annotation.startsWith("after wave")) {
    type = "sequential";
  }

  const taskIds = taskIdStr
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  waves.push({ wave: waveNum, taskIds, type });
}

// --- Extract tasks block ---
const tasksContent = extractTagContent(phaseContent, "tasks");

// --- Parse individual tasks ---
const tasks: Record<string, TaskInfo> = {};
const taskHeaderRegex = /^####\s+\d+\.\s+/m;
const taskSections = tasksContent.split(taskHeaderRegex);
const taskHeaders = [...tasksContent.matchAll(/^####\s+\d+\.\s+(.+)$/gm)];

for (let i = 0; i < taskHeaders.length; i++) {
  const title = taskHeaders[i][1].trim();
  const sectionContent = taskSections[i + 1] || "";

  // Extract ID
  const idMatch = sectionContent.match(/\*\*ID\*\*:\s*(\S+)/i);
  const id = idMatch ? idMatch[1] : "";

  // Extract Assigned To
  const assignedMatch = sectionContent.match(/\*\*Assigned To\*\*:\s*(\S+)/i);
  const assignedTo = assignedMatch ? assignedMatch[1] : "";

  // Full content includes header + body
  const fullContent = `#### ${taskHeaders[i][0].match(/\d+/)?.[0] || i + 1}. ${title}\n${sectionContent.trimEnd()}`;

  if (id) {
    tasks[id] = { id, assignedTo, title, content: fullContent };
  }
}

// --- Cross-reference: verify wave task IDs exist ---
for (const wave of waves) {
  for (const tid of wave.taskIds) {
    if (!tasks[tid]) {
      console.error(`Warning: Wave ${wave.wave} references unknown task ID "${tid}"`);
    }
  }
}

// --- Output ---
console.log(JSON.stringify({ waves, tasks }, null, 2));
