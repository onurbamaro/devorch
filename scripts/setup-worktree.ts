/**
 * setup-worktree.ts — Creates a git worktree for parallel plan execution.
 * Usage: bun ~/.claude/devorch-scripts/setup-worktree.ts --name <kebab-case-name> [--secondary '<json>'] [--recreate] [--add-secondary '<json>']
 * Output: JSON {"worktreePath", "branch", "devorch": true|false, "satellites"?: [...]}
 * Creates .worktrees/<name> with branch devorch/<name>. Copies uncommitted .devorch/ files.
 * With --secondary, also creates worktrees in secondary repos.
 * With --recreate, safely removes existing worktree + branch before recreating.
 * With --add-secondary, adds satellite worktrees to an existing primary worktree.
 */
import { existsSync, mkdirSync, cpSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "./lib/args";
import { isGitRepo, checkBranchExists, getUncommittedFiles } from "./lib/git-utils";

const args = parseArgs<{ name: string; secondary: string; recreate: boolean; "add-secondary": string }>([
  { name: "name", type: "string", required: true },
  { name: "secondary", type: "string", required: false },
  { name: "recreate", type: "boolean", required: false },
  { name: "add-secondary", type: "string", required: false },
]);

// Mutual exclusion: --secondary and --add-secondary
if (args.secondary && args["add-secondary"]) {
  console.error("--secondary and --add-secondary are mutually exclusive");
  process.exit(1);
}

const name = args.name;
const cwd = process.cwd();
const worktreesDir = join(cwd, ".worktrees");
const worktreePath = join(worktreesDir, name);
const branch = `devorch/${name}`;

/**
 * Removes an existing worktree and its branch safely.
 * Uses git branch -d (safe delete) — fails if branch has unmerged commits.
 */
function removeWorktreeAndBranch(wtPath: string, branchName: string, repoCwd: string, label: string): void {
  // Remove the worktree
  const removeProc = Bun.spawnSync(["git", "-C", repoCwd, "worktree", "remove", wtPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (removeProc.exitCode !== 0) {
    const stderr = removeProc.stderr.toString("utf-8").trim();
    console.error(`Failed to remove ${label} worktree: ${stderr}`);
    process.exit(1);
  }

  // Safe delete the branch
  const branchProc = Bun.spawnSync(["git", "-C", repoCwd, "branch", "-d", branchName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (branchProc.exitCode !== 0) {
    console.error(`Branch ${branchName} has unmerged commits. Use git branch -D to force delete.`);
    process.exit(1);
  }
}

// SatelliteResult interface
interface SatelliteResult {
  name: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  warnings: string[];
}

/**
 * Creates satellite worktrees from a JSON array of repos.
 * Shared by --secondary and --add-secondary flows.
 */
function createSatellites(jsonStr: string, recreate: boolean): SatelliteResult[] {
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

  const results: SatelliteResult[] = [];

  for (const repo of secondaryRepos) {
    const repoPath = resolve(cwd, repo.path);
    const satWarnings: string[] = [];

    // Validate git repo
    if (!isGitRepo(repoPath)) {
      console.error(`Secondary repo "${repo.name}" at ${repoPath} is not a git repository`);
      process.exit(1);
    }

    const satWorktreesDir = join(repoPath, ".worktrees");
    const satWorktreePath = join(satWorktreesDir, name);

    // Handle existing satellite worktree with --recreate
    if (existsSync(satWorktreePath)) {
      if (recreate) {
        removeWorktreeAndBranch(satWorktreePath, branch, repoPath, `satellite "${repo.name}"`);
      } else {
        console.error(`Satellite worktree for "${repo.name}" already exists at ${satWorktreePath}`);
        process.exit(1);
      }
    } else if (checkBranchExists(repoPath, branch)) {
      // Worktree doesn't exist but branch does
      if (recreate) {
        // Just delete the orphan branch
        const branchProc = Bun.spawnSync(["git", "-C", repoPath, "branch", "-d", branch], {
          stdout: "pipe",
          stderr: "pipe",
        });
        if (branchProc.exitCode !== 0) {
          console.error(`Branch ${branch} has unmerged commits. Use git branch -D to force delete.`);
          process.exit(1);
        }
      } else {
        console.error(`Secondary repo "${repo.name}": branch "${branch}" already exists`);
        process.exit(1);
      }
    }

    // Check uncommitted changes (warning only)
    const uncommitted = getUncommittedFiles(repoPath);
    if (uncommitted.length > 0) {
      const msg = `Secondary repo "${repo.name}" has ${uncommitted.length} uncommitted file(s)`;
      console.error(`Warning: ${msg}`);
      satWarnings.push(msg);
    }

    // Ensure .worktrees/ in satellite .gitignore
    const worktreesEntry = ".worktrees/";
    const satGitignorePath = join(repoPath, ".gitignore");
    if (existsSync(satGitignorePath)) {
      const satGitignoreContent = readFileSync(satGitignorePath, "utf-8");
      if (!satGitignoreContent.split("\n").some((line) => line.trim() === worktreesEntry)) {
        appendFileSync(satGitignorePath, `\n${worktreesEntry}\n`, "utf-8");
      }
    } else {
      writeFileSync(satGitignorePath, `${worktreesEntry}\n`, "utf-8");
    }

    // Create satellite worktree
    mkdirSync(satWorktreesDir, { recursive: true });

    const satProc = Bun.spawnSync(
      ["git", "-C", repoPath, "worktree", "add", satWorktreePath, "-b", branch],
      { stdout: "pipe", stderr: "pipe" }
    );

    if (satProc.exitCode !== 0) {
      const stderr = satProc.stderr.toString("utf-8").trim();
      console.error(`Failed to create satellite worktree for "${repo.name}": ${stderr}`);
      process.exit(1);
    }

    results.push({
      name: repo.name,
      repoPath,
      worktreePath: satWorktreePath,
      branch,
      warnings: satWarnings,
    });
  }

  return results;
}

// --add-secondary mode: add satellites to existing worktree
if (args["add-secondary"]) {
  // Worktree must already exist
  if (!existsSync(worktreePath)) {
    console.error(`Worktree ${name} does not exist. Use --secondary for initial creation.`);
    process.exit(1);
  }

  // Branch must already exist
  if (!checkBranchExists(cwd, branch)) {
    console.error(`Branch ${branch} does not exist. Create the worktree first.`);
    process.exit(1);
  }

  const satellites = createSatellites(args["add-secondary"], args.recreate);

  const output: Record<string, unknown> = {
    satellites,
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

// Normal mode: create primary worktree

// Handle existing worktree
if (existsSync(worktreePath)) {
  if (args.recreate) {
    removeWorktreeAndBranch(worktreePath, branch, cwd, "primary");
  } else {
    console.error(`Worktree already exists: ${worktreePath}`);
    process.exit(1);
  }
} else if (args.recreate && checkBranchExists(cwd, branch)) {
  // Worktree doesn't exist but branch does — clean up orphan branch
  const branchProc = Bun.spawnSync(["git", "branch", "-d", branch], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (branchProc.exitCode !== 0) {
    console.error(`Branch ${branch} has unmerged commits. Use git branch -D to force delete.`);
    process.exit(1);
  }
}

// Ensure .worktrees/ is in .gitignore
const gitignorePath = join(cwd, ".gitignore");
const worktreesEntry = ".worktrees/";
if (existsSync(gitignorePath)) {
  const content = readFileSync(gitignorePath, "utf-8");
  if (!content.split("\n").some((line) => line.trim() === worktreesEntry)) {
    appendFileSync(gitignorePath, `\n${worktreesEntry}\n`, "utf-8");
  }
} else {
  writeFileSync(gitignorePath, `${worktreesEntry}\n`, "utf-8");
}

// Create .worktrees directory
mkdirSync(worktreesDir, { recursive: true });

// Create git worktree
const worktreeProc = Bun.spawnSync(["git", "worktree", "add", worktreePath, "-b", branch], {
  cwd,
  stdout: "pipe",
  stderr: "pipe",
});

if (worktreeProc.exitCode !== 0) {
  const stderr = worktreeProc.stderr.toString("utf-8").trim();
  console.error(`Failed to create worktree: ${stderr}`);
  process.exit(1);
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
  const filesToCopy = [...changedFiles, ...untrackedFiles]
    .filter((f) => !f.endsWith("explore-cache.md"));

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

  // Ensure .devorch/plans/ directory exists in worktree
  mkdirSync(join(devorchDst, "plans"), { recursive: true });
}

// Setup satellite worktrees if --secondary provided
const satellites: SatelliteResult[] = [];

if (args.secondary) {
  satellites.push(...createSatellites(args.secondary, args.recreate));
}

const output: Record<string, unknown> = {
  worktreePath: `.worktrees/${name}`,
  branch,
  devorch: devorchCopied,
};

if (satellites.length > 0) {
  output.satellites = satellites;
}

console.log(JSON.stringify(output, null, 2));
