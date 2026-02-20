/**
 * git-utils.ts — Shared git utilities.
 */

/**
 * Detects the main branch name (main or master).
 * Checks: symbolic ref of origin/HEAD → existence of refs/heads/main → fallback to master.
 */
export function getMainBranch(): string {
  // Try origin/HEAD first (most reliable when remote is configured)
  try {
    const proc = Bun.spawnSync(
      ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
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
      ["git", "rev-parse", "--verify", "refs/heads/main"],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (proc.exitCode === 0) return "main";
  } catch {
    // ignore
  }

  return "master";
}
