/**
 * setup-worktree.ts — Atomic worktree creation for a devorch session.
 *
 * Usage: bun ~/.claude/devorch-scripts/setup-worktree.ts --name <kebab-name> [project-dir]
 * Output: JSON {worktreePath, branchName, originalBranch, uncommittedFilesCount, gotchasCopied, suffixed}
 *
 * Behavior:
 *   - mainRoot = project-dir (or cwd if omitted)
 *   - Resolves originalBranch from `git -C <mainRoot> branch --show-current`
 *   - If `.worktrees/<name>` exists OR branch `devorch/<name>` exists, append numeric suffix
 *   - Runs `git worktree add .worktrees/<final-name> -b devorch/<final-name>`
 *   - Persists originalBranch to .devorch/cache/origin-branch.txt inside the worktree
 *   - Copies mainRoot/.devorch/GOTCHAS.md to the worktree if present
 *   - Reports uncommitted file count on mainRoot (not blocking — caller decides)
 */
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{ name: string }>([
  { name: "name", type: "string", required: true },
]);

// Positional [project-dir] resolution — parseArgs only handles --flags
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// First positional that's not a value of --name
const positionalProjectDir = positional.find((p) => p !== args.name);
const mainRoot = positionalProjectDir ? resolve(positionalProjectDir) : process.cwd();

function git(...gitArgs: string[]): { ok: boolean; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["git", "-C", mainRoot, ...gitArgs], {
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    ok: proc.exitCode === 0,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}

function gitRaw(...gitArgs: string[]): { ok: boolean; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["git", ...gitArgs], { cwd: mainRoot, stderr: "pipe", stdout: "pipe" });
  return {
    ok: proc.exitCode === 0,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}

const isGitRepo = git("rev-parse", "--git-dir").ok;
if (!isGitRepo) {
  console.error(`Not a git repository: ${mainRoot}`);
  process.exit(1);
}

const baseName = args.name;
let finalName = baseName;
let suffix = 1;

function nameFree(name: string): boolean {
  const wtPath = join(mainRoot, ".worktrees", name);
  if (existsSync(wtPath)) return false;
  // Branch existence check
  const branchCheck = git("rev-parse", "--verify", `refs/heads/devorch/${name}`);
  if (branchCheck.ok) return false;
  return true;
}

while (!nameFree(finalName)) {
  suffix += 1;
  finalName = `${baseName}-${suffix}`;
  if (suffix > 99) {
    console.error(`Could not find a free name after 99 suffixes: ${baseName}-2..${baseName}-99 all taken`);
    process.exit(1);
  }
}

const branchName = `devorch/${finalName}`;
const worktreePath = join(mainRoot, ".worktrees", finalName);

const originalBranch = git("branch", "--show-current").stdout || "HEAD";

const uncommitted = git("status", "--porcelain").stdout;
const uncommittedFilesCount = uncommitted ? uncommitted.split("\n").filter(Boolean).length : 0;

// Create the worktree on a new branch
const wtResult = gitRaw("worktree", "add", worktreePath, "-b", branchName);
if (!wtResult.ok) {
  console.error(`git worktree add failed: ${wtResult.stderr}`);
  process.exit(1);
}

// Persist origin-branch for resume
const cacheDir = join(worktreePath, ".devorch", "cache");
mkdirSync(cacheDir, { recursive: true });
writeFileSync(join(cacheDir, "origin-branch.txt"), `${originalBranch}\n`);

// Copy GOTCHAS.md forward if present
let gotchasCopied = false;
const srcGotchas = join(mainRoot, ".devorch", "GOTCHAS.md");
const dstGotchas = join(worktreePath, ".devorch", "GOTCHAS.md");
if (existsSync(srcGotchas) && !existsSync(dstGotchas)) {
  mkdirSync(join(worktreePath, ".devorch"), { recursive: true });
  copyFileSync(srcGotchas, dstGotchas);
  gotchasCopied = true;
}

console.log(JSON.stringify({
  worktreePath: worktreePath.replaceAll("\\", "/"),
  branchName,
  originalBranch,
  uncommittedFilesCount,
  gotchasCopied,
  suffixed: finalName !== baseName,
}));
