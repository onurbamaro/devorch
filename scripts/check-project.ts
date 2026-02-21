/**
 * check-project.ts — Detects and runs project validation scripts.
 * Usage: bun ~/.claude/devorch-scripts/check-project.ts [project-dir] [--timeout <ms>] [--no-test]
 *        bun ~/.claude/devorch-scripts/check-project.ts [project-dir] --with-validation --plan <path> --phase <N>
 * Output: JSON with results for lint, typecheck, build, test (and optionally validation)
 */
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { extractTagContent, parsePhaseBounds, readPlan } from "./lib/plan-parser";

// Positional + flag args (shared lib doesn't handle positional args)
let cwd = process.cwd();
let timeoutOverride: number | null = null;
let noTest = false;
let withValidation = false;
let planPath = "";
let phaseNum = 0;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--timeout" && argv[i + 1]) {
    timeoutOverride = parseInt(argv[++i], 10);
  } else if (argv[i] === "--no-test") {
    noTest = true;
  } else if (argv[i] === "--with-validation") {
    withValidation = true;
  } else if (argv[i] === "--plan" && argv[i + 1]) {
    planPath = argv[++i];
  } else if (argv[i] === "--phase" && argv[i + 1]) {
    phaseNum = parseInt(argv[++i], 10);
  } else if (!argv[i].startsWith("--")) {
    cwd = argv[i];
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;
const VALIDATION_TIMEOUT_MS = 30_000;

interface CheckResult {
  [key: string]: "pass" | "skip" | string;
}

interface ValidationResult {
  command: string;
  description: string;
  cwd: string;
  status: "pass" | "fail" | "timeout";
  output?: string;
}

interface ValidationOutput {
  totalCommands: number;
  passed: number;
  failed: number;
  results: ValidationResult[];
}

const results: CheckResult = {};

// --- Parse package.json once ---
const pkgPath = join(cwd, "package.json");
let pkg: { scripts?: Record<string, string> } | null = null;
if (existsSync(pkgPath)) {
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    // ignore
  }
}

function detectPkgScript(name: string): string | null {
  if (!pkg) return null;
  const scripts = pkg.scripts || {};
  return scripts[name] ? name : null;
}

function detectPackageManager(): string {
  const lockFiles: [string, string][] = [
    ["bun.lockb", "bun run"],
    ["bun.lock", "bun run"],
    ["pnpm-lock.yaml", "pnpm run"],
    ["yarn.lock", "yarn"],
  ];
  for (const [file, pm] of lockFiles) {
    if (existsSync(join(cwd, file))) return pm;
  }
  return "npm run";
}

const pm = detectPackageManager();

// --- Define checks ---
interface CheckDef {
  name: string;
  detect: () => string | null;
}

const checks: CheckDef[] = [
  {
    name: "lint",
    detect: () => {
      const script = detectPkgScript("lint");
      return script ? `${pm} ${script}` : null;
    },
  },
  {
    name: "typecheck",
    detect: () => {
      const script = detectPkgScript("typecheck") || detectPkgScript("type-check");
      if (script) return `${pm} ${script}`;
      if (existsSync(join(cwd, "tsconfig.json"))) {
        const npxCmd = pm.startsWith("bun") ? "bunx" : "npx";
        return `${npxCmd} tsc --noEmit`;
      }
      return null;
    },
  },
  {
    name: "build",
    detect: () => {
      const script = detectPkgScript("build");
      return script ? `${pm} ${script}` : null;
    },
  },
  {
    name: "test",
    detect: () => {
      const script = detectPkgScript("test");
      if (!script) return null;
      const cmd = pkg?.scripts?.test || "";
      if (cmd === 'echo "Error: no test specified" && exit 1') return null;
      return `${pm} ${script}`;
    },
  },
];

// --- Run a single check ---
async function runCheck(name: string, command: string, timeoutMs: number): Promise<string> {
  const [cmd, ...cmdArgs] = command.split(" ");
  try {
    const proc = Bun.spawn([cmd, ...cmdArgs], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => proc.kill(), timeoutMs);

    const exitCode = await proc.exited;
    clearTimeout(timeout);

    if (exitCode === 0) return "pass";

    const stderr = await new Response(proc.stderr).text();
    const lastLines = stderr
      .trim()
      .split("\n")
      .slice(-3)
      .join(" ")
      .slice(0, 200);
    return `fail: ${lastLines || `exit code ${exitCode}`}`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `error: ${msg.slice(0, 100)}`;
  }
}

// --- Validation helpers (mirrors run-validation.ts logic) ---
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

async function runValidationCommand(command: string, runCwd: string): Promise<{ status: "pass" | "fail" | "timeout"; output: string }> {
  const shell = ["bash", "-c", command];

  try {
    const proc = Bun.spawn(shell, {
      cwd: runCwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => {
      proc.kill();
    }, VALIDATION_TIMEOUT_MS);

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

async function runValidation(): Promise<ValidationOutput> {
  if (!planPath || !phaseNum) {
    console.error("--with-validation requires --plan and --phase");
    process.exit(1);
  }

  const content = readPlan(planPath);
  const phases = parsePhaseBounds(content);

  const targetPhase = phases.find((p) => p.phase === phaseNum);
  if (!targetPhase) {
    return { totalCommands: 0, passed: 0, failed: 0, results: [] };
  }

  const phaseContent = targetPhase.content;
  const validationContent = extractTagContent(phaseContent, "validation");
  if (!validationContent) {
    return { totalCommands: 0, passed: 0, failed: 0, results: [] };
  }

  const commands = parseValidationCommands(validationContent);
  if (commands.length === 0) {
    return { totalCommands: 0, passed: 0, failed: 0, results: [] };
  }

  const tasksContent = extractTagContent(phaseContent, "tasks") || "";
  const workingDirs = extractWorkingDirs(tasksContent);

  const validationResults: ValidationResult[] = [];
  let passed = 0;
  let failed = 0;

  const validationPromises = commands.map(async ({ command, description }) => {
    const cmdCwd = resolve(determineCwd(command, workingDirs));
    const result = await runValidationCommand(command, cmdCwd);

    const entry: ValidationResult = {
      command,
      description,
      cwd: cmdCwd.replaceAll("\\", "/"),
      status: result.status,
    };

    if (result.status !== "pass") {
      entry.output = result.output;
    }

    return entry;
  });

  const allValidationResults = await Promise.all(validationPromises);
  for (const entry of allValidationResults) {
    if (entry.status === "pass") {
      passed++;
    } else {
      failed++;
    }
    validationResults.push(entry);
  }

  return {
    totalCommands: commands.length,
    passed,
    failed,
    results: validationResults,
  };
}

// --- Run all checks in parallel ---
const defaultTimeout = timeoutOverride ?? DEFAULT_TIMEOUT_MS;
const allChecks: Promise<[string, string]>[] = [];

for (const check of checks) {
  if (noTest && check.name === "test") {
    results.test = "skip";
    continue;
  }
  const cmd = check.detect();
  if (cmd) {
    const timeout = check.name === "test" ? (timeoutOverride ?? TEST_TIMEOUT_MS) : defaultTimeout;
    allChecks.push(runCheck(check.name, cmd, timeout).then((r) => [check.name, r]));
  } else {
    results[check.name] = "skip";
  }
}

// Run validation in parallel with checks if --with-validation is set
const validationPromise = withValidation ? runValidation() : null;

const allResults = await Promise.all(allChecks);
for (const [name, result] of allResults) {
  results[name] = result;
}

// Build final output
const output: Record<string, unknown> = { ...results };

if (validationPromise) {
  output.validation = await validationPromise;
}

console.log(JSON.stringify(output, null, 2));
