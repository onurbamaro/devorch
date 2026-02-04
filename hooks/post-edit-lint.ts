/**
 * PostToolUse hook — runs project linter on edited files.
 * Catches lint errors immediately after Write/Edit instead of at end of task.
 *
 * Input: tool use JSON on stdin (from Claude Code hooks system)
 * Output: lint errors on stdout (shown to agent) or nothing if clean
 * Exit: 0 = ok or skipped, 1 = lint errors found
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname, extname } from "path";

const input = await new Response(Bun.stdin.stream()).text();

let filePath: string;
try {
  const data = JSON.parse(input);
  filePath = data.tool_input?.file_path;
  if (!filePath) process.exit(0);
} catch {
  process.exit(0);
}

// Only lint JS/TS files
const lintable = new Set([
  ".js", ".jsx", ".ts", ".tsx",
  ".mjs", ".cjs", ".mts", ".cts",
  ".vue", ".svelte",
]);
if (!lintable.has(extname(filePath).toLowerCase())) process.exit(0);

// Find project root (walk up looking for package.json)
function findRoot(start: string): string | null {
  let dir = dirname(start);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const root = findRoot(filePath);
if (!root) process.exit(0);

// Detect linter binary in node_modules/.bin
const isWin = process.platform === "win32";
const ext = isWin ? ".cmd" : "";
const binDir = join(root, "node_modules", ".bin");

interface LintCmd {
  name: string;
  cmd: string[];
}

function detect(): LintCmd | null {
  // Biome — fast, handles lint + format
  const biome = join(binDir, "biome" + ext);
  if (existsSync(biome)) {
    return { name: "biome", cmd: [biome, "lint", filePath] };
  }

  // ESLint
  const eslint = join(binDir, "eslint" + ext);
  if (existsSync(eslint)) {
    return { name: "eslint", cmd: [eslint, "--no-error-on-unmatched-pattern", filePath] };
  }

  return null;
}

const linter = detect();
if (!linter) process.exit(0);

// Run linter on the specific file
try {
  const proc = Bun.spawn(linter.cmd, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0", NODE_NO_WARNINGS: "1" },
  });

  const exitCode = await proc.exited;
  if (exitCode === 0) process.exit(0);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const output = (stdout + "\n" + stderr).trim().slice(0, 2000);

  console.log(`[${linter.name}] ${output}`);
  process.exit(1);
} catch {
  // Linter failed to run — don't block the agent
  process.exit(0);
}
