/**
 * check-project.ts — Detects and runs project validation scripts.
 * Usage: bun ~/.claude/devorch-scripts/check-project.ts [project-dir]
 * Output: JSON with results for lint, typecheck, build, test
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const cwd = process.argv[2] || process.cwd();
const TIMEOUT_MS = 60_000;

interface CheckResult {
  [key: string]: "pass" | "skip" | string;
}

const results: CheckResult = {};

// --- Detect available checks ---
interface CheckDef {
  name: string;
  detect: () => string | null; // returns command or null
}

function detectPkgScript(name: string): string | null {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts || {};
    if (scripts[name]) return name;
  } catch {
    // ignore
  }
  return null;
}

function detectPackageManager(): string {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun run";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm run";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm run";
}

const pm = detectPackageManager();

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
      // Fallback: check if tsconfig exists
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
      // Avoid interactive test watchers
      const pkgPath = join(cwd, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const cmd = pkg.scripts?.test || "";
        if (cmd === 'echo "Error: no test specified" && exit 1') return null;
        return `${pm} ${script}`;
      } catch {
        return null;
      }
    },
  },
];

// --- Run checks ---
async function runCheck(name: string, command: string): Promise<string> {
  const [cmd, ...args] = command.split(" ");
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => proc.kill(), TIMEOUT_MS);

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

for (const check of checks) {
  const command = check.detect();
  if (!command) {
    results[check.name] = "skip";
    continue;
  }
  results[check.name] = await runCheck(check.name, command);
}

console.log(JSON.stringify(results, null, 2));
