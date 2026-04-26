/**
 * setup-worktree.ts — Creates a git worktree for parallel plan execution.
 * Usage: bun ~/.claude/devorch-scripts/setup-worktree.ts --name <kebab-case-name> [--secondary '<json>'] [--recreate] [--add-secondary '<json>'] [--sparse-paths '<dirs>']
 * Output: JSON {"worktreePath", "branch", "devorch": true|false, "satellites"?: [...]}
 * Creates .worktrees/<name> with branch devorch/<name>. Copies uncommitted .devorch/ files.
 * With --secondary, also creates worktrees in secondary repos.
 * With --recreate, safely removes existing worktree + branch before recreating.
 * With --add-secondary, adds satellite worktrees to an existing primary worktree.
 */
import { existsSync, mkdirSync, cpSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "./lib/args";
import { isGitRepo, checkBranchExists, getUncommittedFiles, getUntrackedFiles } from "./lib/git-utils";

const args = parseArgs<{ name: string; secondary: string; recreate: boolean; "add-secondary": string; "sparse-paths": string; "no-env": boolean }>([
  { name: "name", type: "string", required: true },
  { name: "secondary", type: "string", required: false },
  { name: "recreate", type: "boolean", required: false },
  { name: "add-secondary", type: "string", required: false },
  { name: "sparse-paths", type: "string", required: false },
  { name: "no-env", type: "boolean", required: false },
]);

// Mutual exclusion: --secondary and --add-secondary
if (args.secondary && args["add-secondary"]) {
  console.error("--secondary and --add-secondary are mutually exclusive");
  process.exit(1);
}

const name = args.name;

/**
 * Resolves the real mainRoot when invoked from inside an existing worktree.
 * Walks up process.cwd(), finds the LAST `.worktrees` path segment, and returns
 * the path up to (but not including) that segment. Returns process.cwd() unchanged
 * when no `.worktrees` segment is present.
 */
function resolveMainRoot(): string {
  const initial = process.cwd();
  const segments = initial.split("/");
  let lastIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === ".worktrees") lastIdx = i;
  }
  if (lastIdx === -1) return initial;
  const resolved = segments.slice(0, lastIdx).join("/") || "/";
  console.error(`Detected cwd inside .worktrees/; resolved mainRoot = ${resolved}`);
  return resolved;
}

const cwd = resolveMainRoot();
const worktreesDir = join(cwd, ".worktrees");
const worktreePath = join(worktreesDir, name);
const branch = `devorch/${name}`;

/**
 * Removes an existing worktree and its branch safely.
 * Uses git branch -d (safe delete) — fails if branch has unmerged commits.
 */
function removeWorktreeAndBranch(wtPath: string, branchName: string, repoCwd: string, label: string): void {
  const removeProc = Bun.spawnSync(["git", "-C", repoCwd, "worktree", "remove", wtPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (removeProc.exitCode !== 0) {
    const stderr = removeProc.stderr.toString("utf-8").trim();
    console.error(`Failed to remove ${label} worktree: ${stderr}`);
    process.exit(1);
  }

  const branchProc = Bun.spawnSync(["git", "-C", repoCwd, "branch", "-d", branchName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (branchProc.exitCode !== 0) {
    console.error(`Branch ${branchName} has unmerged commits. Use git branch -D to force delete.`);
    process.exit(1);
  }
}

/**
 * Applies sparse-checkout to a worktree if --sparse-paths is provided.
 * Always includes .devorch and root config files as base paths.
 * Non-blocking — logs warning on failure and continues.
 */
const BASE_SPARSE_PATHS = [".devorch"];

function applySparseCheckout(wtPath: string, sparsePaths: string, _repoCwd: string): string[] | null {
  try {
    const initProc = Bun.spawnSync(
      ["git", "-C", wtPath, "sparse-checkout", "init", "--cone"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (initProc.exitCode !== 0) {
      const stderr = initProc.stderr.toString("utf-8").trim();
      console.error(`Warning: sparse-checkout init failed: ${stderr}`);
      Bun.spawnSync(["git", "-C", wtPath, "sparse-checkout", "disable"]);
      return null;
    }

    const userPaths = sparsePaths.split(",").map((p) => p.trim()).filter(Boolean);

    const uniquePaths = [...new Set([...BASE_SPARSE_PATHS, ...userPaths])];

    const setProc = Bun.spawnSync(
      ["git", "-C", wtPath, "sparse-checkout", "set", ...uniquePaths],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (setProc.exitCode !== 0) {
      const stderr = setProc.stderr.toString("utf-8").trim();
      console.error(`Warning: sparse-checkout set failed: ${stderr}`);
      Bun.spawnSync(["git", "-C", wtPath, "sparse-checkout", "disable"]);
      return null;
    }

    return uniquePaths;
  } catch (e) {
    console.error(`Warning: sparse-checkout failed: ${e}`);
    Bun.spawnSync(["git", "-C", wtPath, "sparse-checkout", "disable"]);
    return null;
  }
}

interface SatelliteResult {
  name: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  warnings: string[];
}

interface CreateSingleWorktreeOpts {
  repoPath: string;
  worktreePath: string;
  branchName: string;
  sparsePaths?: string;
  recreate?: boolean;
}

/**
 * Shared function for creating a single worktree (primary or satellite).
 * Handles: .gitignore entry, mkdir, conflict resolution, git worktree add, sparse-checkout.
 * Returns warnings array. Exits with structured JSON on unrecoverable conflicts.
 */
function createSingleWorktree(opts: CreateSingleWorktreeOpts): { warnings: string[] } {
  const { repoPath, worktreePath: wtPath, branchName, sparsePaths, recreate } = opts;
  const warnings: string[] = [];

  // Ensure .worktrees/ in .gitignore
  const worktreesEntry = ".worktrees/";
  const gitignorePath = join(repoPath, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.split("\n").some((line) => line.trim() === worktreesEntry)) {
      appendFileSync(gitignorePath, `\n${worktreesEntry}\n`, "utf-8");
    }
  } else {
    writeFileSync(gitignorePath, `${worktreesEntry}\n`, "utf-8");
  }

  // Handle existing worktree
  if (existsSync(wtPath)) {
    if (recreate) {
      removeWorktreeAndBranch(wtPath, branchName, repoPath, "worktree");
    } else {
      console.log(JSON.stringify({
        error: "exists",
        worktreePath: wtPath,
        branch: branchName,
        hint: "use --recreate to replace",
      }));
      process.exit(1);
    }
  } else if (checkBranchExists(repoPath, branchName)) {
    if (recreate) {
      const branchProc = Bun.spawnSync(["git", "-C", repoPath, "branch", "-d", branchName], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (branchProc.exitCode !== 0) {
        console.error(`Branch ${branchName} has unmerged commits. Use git branch -D to force delete.`);
        process.exit(1);
      }
    } else {
      console.log(JSON.stringify({
        error: "orphan-branch",
        branch: branchName,
        hint: "use --recreate to clean up",
      }));
      process.exit(1);
    }
  }

  // Create parent directory
  const parentDir = resolve(wtPath, "..");
  mkdirSync(parentDir, { recursive: true });

  // Create git worktree
  const wtProc = Bun.spawnSync(
    ["git", "-C", repoPath, "worktree", "add", wtPath, "-b", branchName],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (wtProc.exitCode !== 0) {
    const stderr = wtProc.stderr.toString("utf-8").trim();
    console.error(`Failed to create worktree: ${stderr}`);
    process.exit(1);
  }

  // Apply sparse-checkout if provided
  if (sparsePaths) {
    const sparseResult = applySparseCheckout(wtPath, sparsePaths, repoPath);
    if (!sparseResult) {
      warnings.push("sparse-checkout failed — using full checkout");
    }
  }

  return { warnings };
}

/**
 * Creates satellite worktrees from a JSON array of repos.
 * Satellites are created in parallel since each operates on a different repo.
 * Shared by --secondary and --add-secondary flows.
 */
async function createSatellites(jsonStr: string, recreate: boolean): Promise<SatelliteResult[]> {
  let secondaryRepos: Array<{ name: string; path: string }>;
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      console.error("--secondary/--add-secondary must be a JSON array");
      process.exit(1);
    }
    secondaryRepos = parsed;
  } catch {
    console.error("Failed to parse secondary JSON");
    process.exit(1);
  }

  // Validate all repos before creating any worktrees
  for (const repo of secondaryRepos) {
    const repoPath = resolve(cwd, repo.path);
    if (!isGitRepo(repoPath)) {
      console.error(`Secondary repo "${repo.name}" at ${repoPath} is not a git repository`);
      process.exit(1);
    }
  }

  // Guard: abort atomically if any satellite has untracked files.
  // Runs BEFORE any worktree mutation so no satellite is created when one is dirty.
  for (const repo of secondaryRepos) {
    const repoPath = resolve(cwd, repo.path);
    const untracked = getUntrackedFiles(repoPath, [".worktrees/", "node_modules/", "dist/"]);
    if (untracked.length > 0) {
      console.log(JSON.stringify({
        ok: false,
        error: "satellite-untracked",
        satellite: repo.name,
        repoPath,
        untrackedFiles: untracked,
      }));
      process.exit(1);
    }
  }

  const results = await Promise.all(secondaryRepos.map(async (repo) => {
    const repoPath = resolve(cwd, repo.path);
    const satWorktreePath = join(repoPath, ".worktrees", name);
    const satWarnings: string[] = [];

    // Check uncommitted changes (warning only)
    const uncommitted = getUncommittedFiles(repoPath);
    if (uncommitted.length > 0) {
      const msg = `Secondary repo "${repo.name}" has ${uncommitted.length} uncommitted file(s)`;
      console.error(`Warning: ${msg}`);
      satWarnings.push(msg);
    }

    const { warnings } = createSingleWorktree({
      repoPath,
      worktreePath: satWorktreePath,
      branchName: branch,
      sparsePaths: args["sparse-paths"] || undefined,
      recreate,
    });

    satWarnings.push(...warnings);

    return {
      name: repo.name,
      repoPath,
      worktreePath: satWorktreePath,
      branch,
      warnings: satWarnings,
    };
  }));

  return results;
}

// --add-secondary mode: add satellites to existing worktree
if (args["add-secondary"]) {
  if (!existsSync(worktreePath)) {
    console.error(`Worktree ${name} does not exist. Use --secondary for initial creation.`);
    process.exit(1);
  }

  if (!checkBranchExists(cwd, branch)) {
    console.error(`Branch ${branch} does not exist. Create the worktree first.`);
    process.exit(1);
  }

  const satellites = await createSatellites(args["add-secondary"], args.recreate);

  const output: Record<string, unknown> = {
    satellites,
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

// Normal mode: create primary worktree
const { warnings: primaryWarnings } = createSingleWorktree({
  repoPath: cwd,
  worktreePath,
  branchName: branch,
  sparsePaths: args["sparse-paths"] || undefined,
  recreate: args.recreate,
});

// Auto-copy .env to worktree (default ON; --no-env to opt out).
let envCopied = false;
const envSrc = join(cwd, ".env");
const envDst = join(worktreePath, ".env");
if (!args["no-env"] && existsSync(envSrc) && !existsSync(envDst)) {
  cpSync(envSrc, envDst, { preserveTimestamps: true });
  envCopied = true;
}

// Copy uncommitted .devorch/ files to worktree
const devorchSrc = join(cwd, ".devorch");
const devorchDst = join(worktreePath, ".devorch");
let devorchCopied = false;

if (existsSync(devorchSrc)) {
  const diffProc = Bun.spawnSync(["git", "diff", "--name-only", "HEAD", "--", ".devorch/"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const untrackedProc = Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard", ".devorch/"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const changedFiles = diffProc.stdout.toString().trim().split("\n").filter(Boolean);
  const untrackedFiles = untrackedProc.stdout.toString().trim().split("\n").filter(Boolean);
  const filesToCopy = [...changedFiles, ...untrackedFiles];

  for (const relPath of filesToCopy) {
    const src = join(cwd, relPath);
    const dst = join(worktreePath, relPath);
    if (existsSync(src)) {
      const dstDir = resolve(dst, "..");
      mkdirSync(dstDir, { recursive: true });
      cpSync(src, dst, { force: true });
      devorchCopied = true;
    }
  }

  mkdirSync(join(devorchDst, "plans"), { recursive: true });
}

// Setup satellite worktrees if --secondary provided
const satellites: SatelliteResult[] = [];

if (args.secondary) {
  satellites.push(...await createSatellites(args.secondary, args.recreate));
}

const output: Record<string, unknown> = {
  worktreePath: `.worktrees/${name}`,
  branch,
  devorch: devorchCopied,
  envCopied,
};

if (primaryWarnings.length > 0) {
  output.warnings = primaryWarnings;
}

if (satellites.length > 0) {
  output.satellites = satellites;
}

console.log(JSON.stringify(output, null, 2));
