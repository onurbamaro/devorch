/**
 * check-project.ts — Detects and runs project validation scripts.
 * Usage: bun ~/.claude/devorch-scripts/check-project.ts [project-dir] [--timeout <ms>]
 * Output: JSON with results for lint, typecheck, build, test
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Positional + flag args (shared lib doesn't handle positional args)
let cwd = process.cwd();
let timeoutOverride: number | null = null;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--timeout" && argv[i + 1]) {
    timeoutOverride = parseInt(argv[++i], 10);
  } else if (!argv[i].startsWith("--")) {
    cwd = argv[i];
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;

interface CheckResult {
  [key: string]: "pass" | "skip" | string;
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

// --- Run lint + typecheck in parallel, then build, then test ---
const lintCmd = checks[0].detect();
const typecheckCmd = checks[1].detect();
const buildCmd = checks[2].detect();
const testCmd = checks[3].detect();

// Parallel: lint + typecheck
const defaultTimeout = timeoutOverride ?? DEFAULT_TIMEOUT_MS;
const parallelChecks: Promise<[string, string]>[] = [];
if (lintCmd) {
  parallelChecks.push(runCheck("lint", lintCmd, defaultTimeout).then((r) => ["lint", r]));
} else {
  results.lint = "skip";
}
if (typecheckCmd) {
  parallelChecks.push(runCheck("typecheck", typecheckCmd, defaultTimeout).then((r) => ["typecheck", r]));
} else {
  results.typecheck = "skip";
}

const parallelResults = await Promise.all(parallelChecks);
for (const [name, result] of parallelResults) {
  results[name] = result;
}

// Sequential: build
if (buildCmd) {
  results.build = await runCheck("build", buildCmd, timeoutOverride ?? DEFAULT_TIMEOUT_MS);
} else {
  results.build = "skip";
}

// Sequential: test
if (testCmd) {
  results.test = await runCheck("test", testCmd, timeoutOverride ?? TEST_TIMEOUT_MS);
} else {
  results.test = "skip";
}

console.log(JSON.stringify(results, null, 2));
