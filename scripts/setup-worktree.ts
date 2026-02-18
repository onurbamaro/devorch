/**
 * setup-worktree.ts — Creates a git worktree for parallel plan execution.
 * Usage: bun ~/.claude/devorch-scripts/setup-worktree.ts --name <kebab-case-name>
 * Output: JSON {"worktreePath", "branch", "devorch": true|false}
 * Creates .worktrees/<name> with branch devorch/<name>. Copies uncommitted .devorch/ files.
 */
import { existsSync, mkdirSync, cpSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

function parseArgs(): { name: string } {
  const args = process.argv.slice(2);
  let name = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      name = args[++i];
    }
  }
  if (!name) {
    console.error("Usage: setup-worktree.ts --name <kebab-case-name>");
    process.exit(1);
  }
  return { name };
}

const { name } = parseArgs();
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
  const stderr = worktreeProc.stderr.toString().trim();
  console.error(`Failed to create worktree: ${stderr}`);
  process.exit(1);
}

// Copy uncommitted .devorch/ files to worktree
const devorchSrc = join(cwd, ".devorch");
const devorchDst = join(worktreePath, ".devorch");
let devorchCopied = false;

if (existsSync(devorchSrc)) {
  // Find files that differ from committed versions (uncommitted changes)
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

console.log(
  JSON.stringify(
    {
      worktreePath: `.worktrees/${name}`,
      branch,
      devorch: devorchCopied,
    },
    null,
    2
  )
);
