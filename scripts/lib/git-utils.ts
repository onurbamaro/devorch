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
 * Returns list of untracked files in the given repo, excluding paths under any of the given
 * path prefixes. Each prefix matches the start of the file path at segment boundaries —
 * `.worktrees/` excludes `.worktrees/foo/bar`, `.devorch/cache/` excludes `.devorch/cache/state.json`
 * but NOT `.devorch/state.md`. Single-segment prefixes (like `dist`) and multi-segment prefixes
 * (like `.devorch/cache`) both work; trailing slashes on prefixes are tolerated.
 * Returns [] on any git error.
 */
export function getUntrackedFiles(repoPath: string, excludePrefixes: string[] = []): string[] {
  try {
    const proc = Bun.spawnSync(
      ["git", "-C", repoPath, "ls-files", "--others", "--exclude-standard"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (proc.exitCode !== 0) return [];
    const files = proc.stdout.toString("utf-8").split("\n").filter(Boolean);
    if (excludePrefixes.length === 0) return files;
    const normalizedPrefixes = excludePrefixes.map((p) => p.replace(/\/+$/, "") + "/");
    return files.filter((f) => {
      const probe = f + "/";
      return !normalizedPrefixes.some((p) => probe.startsWith(p));
    });
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
