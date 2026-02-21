/**
 * setup-worktree.ts — Creates a git worktree for parallel plan execution.
 * Usage: bun ~/.claude/devorch-scripts/setup-worktree.ts --name <kebab-case-name> [--secondary '<json>']
 * Output: JSON {"worktreePath", "branch", "devorch": true|false, "satellites"?: [...]}
 * Creates .worktrees/<name> with branch devorch/<name>. Copies uncommitted .devorch/ files.
 * With --secondary, also creates worktrees in secondary repos.
 */
import { existsSync, mkdirSync, cpSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "./lib/args";
import { isGitRepo, checkBranchExists, getUncommittedFiles } from "./lib/git-utils";

const args = parseArgs<{ name: string; secondary: string }>([
  { name: "name", type: "string", required: true },
  { name: "secondary", type: "string", required: false },
]);

const name = args.name;
const cwd = process.cwd();
const worktreesDir = join(cwd, ".worktrees");
const worktreePath = join(worktreesDir, name);
const branch = `devorch/${name}`;

// Check if worktree already exists
if (existsSync(worktreePath)) {
  console.error(`Worktree already exists: ${worktreePath}`);
  process.exit(1);
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
interface SatelliteResult {
  name: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  warnings: string[];
}

const satellites: SatelliteResult[] = [];

if (args.secondary) {
  let secondaryRepos: Array<{ name: string; path: string }>;
  try {
    const parsed = JSON.parse(args.secondary);
    if (!Array.isArray(parsed)) {
      console.error("--secondary must be a JSON array");
      process.exit(1);
    }
    secondaryRepos = parsed;
  } catch {
    console.error("Failed to parse --secondary JSON");
    process.exit(1);
  }

  for (const repo of secondaryRepos) {
    const repoPath = resolve(cwd, repo.path);
    const satWarnings: string[] = [];

    // Validate git repo
    if (!isGitRepo(repoPath)) {
      console.error(`Secondary repo "${repo.name}" at ${repoPath} is not a git repository`);
      process.exit(1);
    }

    // Check if branch already exists
    if (checkBranchExists(repoPath, branch)) {
      console.error(`Secondary repo "${repo.name}": branch "${branch}" already exists`);
      process.exit(1);
    }

    // Check uncommitted changes (warning only)
    const uncommitted = getUncommittedFiles(repoPath);
    if (uncommitted.length > 0) {
      const msg = `Secondary repo "${repo.name}" has ${uncommitted.length} uncommitted file(s)`;
      console.error(`Warning: ${msg}`);
      satWarnings.push(msg);
    }

    // Ensure .worktrees/ in satellite .gitignore
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
    const satWorktreesDir = join(repoPath, ".worktrees");
    mkdirSync(satWorktreesDir, { recursive: true });
    const satWorktreePath = join(satWorktreesDir, name);

    const satProc = Bun.spawnSync(
      ["git", "-C", repoPath, "worktree", "add", satWorktreePath, "-b", branch],
      { stdout: "pipe", stderr: "pipe" }
    );

    if (satProc.exitCode !== 0) {
      const stderr = satProc.stderr.toString("utf-8").trim();
      console.error(`Failed to create satellite worktree for "${repo.name}": ${stderr}`);
      process.exit(1);
    }

    satellites.push({
      name: repo.name,
      repoPath,
      worktreePath: satWorktreePath,
      branch,
      warnings: satWarnings,
    });
  }
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
