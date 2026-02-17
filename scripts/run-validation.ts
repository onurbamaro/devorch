/**
 * run-validation.ts — Executes validation commands from a plan phase with correct working directories.
 * Usage: bun ~/.claude/devorch-scripts/run-validation.ts --plan <path> --phase <N>
 * Output: JSON {"totalCommands", "passed", "failed", "results": [{command, description, cwd, status, output?}]}
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const DEFAULT_TIMEOUT_MS = 30000;

interface PhaseBounds {
  num: number;
  name: string;
  start: number;
  end: number;
}

interface ValidationResult {
  command: string;
  description: string;
  cwd: string;
  status: "pass" | "fail" | "timeout";
  output?: string;
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
    console.error("Usage: run-validation.ts --plan <path> --phase <N>");
    process.exit(1);
  }
  return { plan, phase };
}

function extractTagContent(text: string, tagName: string): string {
  const match = text.match(new RegExp(`^\\s*<${tagName}>([\\s\\S]*?)^\\s*<\\/${tagName}>`, "im"));
  return match ? match[1].trim() : "";
}

function findPhaseContent(content: string, phaseNum: number): string {
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
  if (!target) return "";
  return lines.slice(target.start, target.end).join("\n");
}

function extractWorkingDirs(tasksContent: string): string[] {
  const dirs: Set<string> = new Set();
  const lines = tasksContent.split("\n");
  for (const line of lines) {
    const match = line.match(/Working directory:\s*`([^`]+)`/) || line.match(/Working directory:\s*(\S+)/);
    if (match) {
      dirs.add(match[1].trim());
    }
  }
  return [...dirs];
}

function parseValidationCommands(validationContent: string): { command: string; description: string }[] {
  const commands: { command: string; description: string }[] = [];
  const lines = validationContent.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const cmdMatch = line.trim().match(/^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/);
    if (cmdMatch) {
      commands.push({ command: cmdMatch[1], description: cmdMatch[2].trim() });
    }
  }
  return commands;
}

function lastNLines(text: string, n: number): string {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.slice(-n).join("\n");
}

async function runCommand(command: string, cwd: string): Promise<{ status: "pass" | "fail" | "timeout"; output: string }> {
  const isWin = process.platform === "win32";
  const shell = isWin ? ["bash", "-c", command] : ["bash", "-c", command];

  try {
    const proc = Bun.spawn(shell, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => {
      proc.kill();
    }, DEFAULT_TIMEOUT_MS);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    clearTimeout(timeout);

    if (exitCode === null || exitCode === undefined) {
      return { status: "timeout", output: lastNLines(stderr || stdout, 5) };
    }

    if (exitCode === 0) {
      return { status: "pass", output: "" };
    }

    return { status: "fail", output: lastNLines(stderr || stdout, 5) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("killed")) {
      return { status: "timeout", output: msg };
    }
    return { status: "fail", output: msg };
  }
}

function determineCwd(command: string, workingDirs: string[]): string {
  if (workingDirs.length === 0) return process.cwd();
  if (workingDirs.length === 1) return workingDirs[0];

  // Try to match path fragments in the command to a working directory
  for (const dir of workingDirs) {
    const dirNorm = dir.replaceAll("\\", "/");
    const parts = dirNorm.split("/");
    const lastPart = parts[parts.length - 1];
    if (command.includes(lastPart + "/") || command.includes(lastPart + "\\")) {
      return dir;
    }
  }

  // Default to first working directory
  return workingDirs[0];
}

// --- Main ---
const { plan: planPath, phase: phaseNum } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

const phaseContent = findPhaseContent(content, phaseNum);
if (!phaseContent) {
  console.error(`Phase ${phaseNum} not found in plan.`);
  process.exit(1);
}

const validationContent = extractTagContent(phaseContent, "validation");
if (!validationContent) {
  console.log(JSON.stringify({ totalCommands: 0, passed: 0, failed: 0, results: [] }));
  process.exit(0);
}

const commands = parseValidationCommands(validationContent);
if (commands.length === 0) {
  console.log(JSON.stringify({ totalCommands: 0, passed: 0, failed: 0, results: [] }));
  process.exit(0);
}

const tasksContent = extractTagContent(phaseContent, "tasks");
const workingDirs = extractWorkingDirs(tasksContent);

const results: ValidationResult[] = [];
let passed = 0;
let failed = 0;

for (const { command, description } of commands) {
  const cwd = resolve(determineCwd(command, workingDirs));
  const result = await runCommand(command, cwd);

  const entry: ValidationResult = {
    command,
    description,
    cwd: cwd.replaceAll("\\", "/"),
    status: result.status,
  };

  if (result.status !== "pass") {
    entry.output = result.output;
    failed++;
  } else {
    passed++;
  }

  results.push(entry);
}

console.log(JSON.stringify({
  totalCommands: commands.length,
  passed,
  failed,
  results,
}));
