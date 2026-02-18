/**
 * list-worktrees.ts — Lists all devorch worktrees with their plan and status info.
 * Usage: bun ~/.claude/devorch-scripts/list-worktrees.ts
 * Output: JSON {"worktrees": [...], "count": N}
 * Each worktree entry: {name, path, branch, planTitle, status, lastPhase, totalPhases, valid}
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  planTitle: string;
  status: string;
  lastPhase: number;
  totalPhases: number;
  valid: boolean;
}

function safeReadFile(filePath: string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8");
    }
  } catch {
    // ignore — optional file
  }
  return "";
}

function extractPlanTitle(planContent: string): string {
  const match = planContent.match(/^#\s+Plan:\s+(.+)$/m);
  return match ? match[1].trim() : "(no plan)";
}

function countPhases(planContent: string): number {
  const matches = planContent.match(/<phase\d+\s/g);
  return matches ? matches.length : 0;
}

function extractStatus(stateContent: string): { status: string; lastPhase: number } {
  if (!stateContent) return { status: "not started", lastPhase: 0 };

  const statusMatch = stateContent.match(/^Status:\s*(.+)$/m);
  const phaseMatch = stateContent.match(/^Last completed phase:\s*(\d+)/m);

  return {
    status: statusMatch ? statusMatch[1].trim() : "not started",
    lastPhase: phaseMatch ? parseInt(phaseMatch[1], 10) : 0,
  };
}

function getBranch(worktreePath: string): string {
  try {
    const proc = Bun.spawnSync(["git", "-C", worktreePath, "branch", "--show-current"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0) {
      return proc.stdout.toString("utf-8").trim();
    }
  } catch {
    // ignore
  }
  return "";
}

function getValidWorktrees(): Set<string> {
  const valid = new Set<string>();
  try {
    const proc = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0) {
      const output = proc.stdout.toString("utf-8");
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          valid.add(line.slice(9).trim().replaceAll("\\", "/"));
        }
      }
    }
  } catch {
    // ignore
  }
  return valid;
}

const cwd = process.cwd();
const worktreesDir = join(cwd, ".worktrees");

if (!existsSync(worktreesDir)) {
  console.log(JSON.stringify({ worktrees: [], count: 0 }));
  process.exit(0);
}

const validPaths = getValidWorktrees();

const entries = readdirSync(worktreesDir).filter((entry) => {
  try {
    return statSync(join(worktreesDir, entry)).isDirectory();
  } catch {
    return false;
  }
}).sort();

const worktrees: WorktreeInfo[] = [];

for (const name of entries) {
  const wtPath = join(worktreesDir, name);
  const relPath = `.worktrees/${name}`;

  const planContent = safeReadFile(join(wtPath, ".devorch/plans/current.md"));
  const stateContent = safeReadFile(join(wtPath, ".devorch/state.md"));

  const planTitle = planContent ? extractPlanTitle(planContent) : "(no plan)";
  const totalPhases = planContent ? countPhases(planContent) : 0;
  const { status, lastPhase } = extractStatus(stateContent);
  const branch = getBranch(wtPath);
  const absPath = resolve(wtPath).replaceAll("\\", "/");
  const valid = validPaths.has(absPath);

  worktrees.push({
    name,
    path: relPath,
    branch,
    planTitle,
    status,
    lastPhase,
    totalPhases,
    valid,
  });
}

console.log(JSON.stringify({ worktrees, count: worktrees.length }, null, 2));
