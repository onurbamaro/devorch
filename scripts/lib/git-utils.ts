/**
 * git-utils.ts — Shared git utilities.
 */

/**
 * Detects the main branch name (main or master) for the given repo.
 * Checks: symbolic ref of origin/HEAD → existence of refs/heads/main → fallback to master.
 * If repoPath is omitted, operates in the current working directory (backwards compatible).
 */
export function getMainBranch(repoPath?: string): string {
  const gitPrefix = repoPath ? ["-C", repoPath] : [];
  // Try origin/HEAD first (most reliable when remote is configured)
  try {
    const proc = Bun.spawnSync(
      ["git", ...gitPrefix, "symbolic-ref", "refs/remotes/origin/HEAD"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (proc.exitCode === 0) {
      const ref = proc.stdout.toString("utf-8").trim();
      const branch = ref.replace(/^refs\/remotes\/origin\//, "");
      if (branch) return branch;
    }
  } catch {
    // ignore
  }

  // Fallback: check if local "main" branch exists
  try {
    const proc = Bun.spawnSync(
      ["git", ...gitPrefix, "rev-parse", "--verify", "refs/heads/main"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (proc.exitCode === 0) return "main";
  } catch {
    // ignore
  }

  return "master";
}

/**
 * Checks if a branch exists in the given repo.
 */
export function checkBranchExists(repoPath: string, branch: string): boolean {
  try {
    const proc = Bun.spawnSync(
      ["git", "-C", repoPath, "rev-parse", "--verify", branch],
      { stdout: "pipe", stderr: "pipe" }
    );
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Returns list of uncommitted files (staged + unstaged + untracked) in the given repo.
 */
export function getUncommittedFiles(repoPath: string): string[] {
  try {
    const proc = Bun.spawnSync(
      ["git", "-C", repoPath, "status", "--porcelain"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (proc.exitCode !== 0) return [];
    return proc.stdout.toString("utf-8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Checks if the given path is a git repository.
 */
export function isGitRepo(repoPath: string): boolean {
  try {
    const proc = Bun.spawnSync(
      ["git", "-C", repoPath, "rev-parse", "--git-dir"],
      { stdout: "pipe", stderr: "pipe" }
    );
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
