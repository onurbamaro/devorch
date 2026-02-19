/**
 * run-validation.ts — Executes validation commands from a plan phase with correct working directories.
 * Usage: bun ~/.claude/devorch-scripts/run-validation.ts --plan <path> --phase <N>
 * Output: JSON {"totalCommands", "passed", "failed", "results": [{command, description, cwd, status, output?}]}
 */
import { resolve } from "path";
import { parseArgs } from "./lib/args";
import { extractTagContent, parsePhaseBounds, readPlan } from "./lib/plan-parser";

const DEFAULT_TIMEOUT_MS = 30000;

interface ValidationResult {
  command: string;
  description: string;
  cwd: string;
  status: "pass" | "fail" | "timeout";
  output?: string;
}

const args = parseArgs<{ plan: string; phase: number }>([
  { name: "plan", type: "string", required: true },
  { name: "phase", type: "number", required: true },
]);

const planPath = args.plan;
const phaseNum = args.phase;

const content = readPlan(planPath);
const phases = parsePhaseBounds(content);

const targetPhase = phases.find((p) => p.phase === phaseNum);
if (!targetPhase) {
  console.error(`Phase ${phaseNum} not found in plan.`);
  process.exit(1);
}

const phaseContent = targetPhase.content;
const validationContent = extractTagContent(phaseContent, "validation");
if (!validationContent) {
  console.log(JSON.stringify({ totalCommands: 0, passed: 0, failed: 0, results: [] }));
  process.exit(0);
}

function parseValidationCommands(text: string): { command: string; description: string }[] {
  const commands: { command: string; description: string }[] = [];
  const lines = text.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const cmdMatch = line.trim().match(/^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/);
    if (cmdMatch) {
      commands.push({ command: cmdMatch[1], description: cmdMatch[2].trim() });
    }
  }
  return commands;
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

function lastNLines(text: string, n: number): string {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.slice(-n).join("\n");
}

async function runCommand(command: string, cwd: string): Promise<{ status: "pass" | "fail" | "timeout"; output: string }> {
  const shell = ["bash", "-c", command];

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

  for (const dir of workingDirs) {
    const dirNorm = dir.replaceAll("\\", "/");
    const parts = dirNorm.split("/");
    const lastPart = parts[parts.length - 1];
    if (command.includes(lastPart + "/") || command.includes(lastPart + "\\")) {
      return dir;
    }
  }

  return workingDirs[0];
}

const commands = parseValidationCommands(validationContent);
if (commands.length === 0) {
  console.log(JSON.stringify({ totalCommands: 0, passed: 0, failed: 0, results: [] }));
  process.exit(0);
}

const tasksContent = extractTagContent(phaseContent, "tasks") || "";
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
