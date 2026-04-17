/**
 * merge-worktree.ts — v3 merge flow for a devorch worktree.
 *
 * Flow: rebase → check → stats → merge → cleanup → archive.
 *
 * Usage: bun scripts/merge-worktree.ts --worktree <name> [--squash] [--keep-branch] [--no-rebase] [--dry-run]
 * Output: JSON on stdout, logs on stderr.
 * Exit codes: 0 success, 1 handled error, 2 unexpected error.
 */
import { existsSync, readdirSync } from "fs";
import { join, resolve, basename } from "path";
import { parseArgs } from "./lib/args";
import { getMainBranch, isGitRepo, getUncommittedFiles } from "./lib/git-utils";
import { safeReadFile } from "./lib/fs-utils";
import { extractPlanTitle } from "./lib/plan-parser";

interface Args {
  worktree: string;
  squash: boolean;
  "keep-branch": boolean;
  "no-rebase": boolean;
  "dry-run": boolean;
}

const args = parseArgs<Args>([
  { name: "worktree", type: "string", required: true },
  { name: "squash", type: "boolean", required: false },
  { name: "keep-branch", type: "boolean", required: false },
  { name: "no-rebase", type: "boolean", required: false },
  { name: "dry-run", type: "boolean", required: false },
]);

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function git(repoPath: string, gitArgs: string[]): GitResult {
  const proc = Bun.spawnSync(["git", "-C", repoPath, ...gitArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString("utf-8").trim(),
    stderr: proc.stderr.toString("utf-8").trim(),
  };
}

function log(msg: string): void {
  console.error(msg);
}

function emit(obj: Record<string, unknown>): void {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(error: string, extra: Record<string, unknown> = {}): never {
  emit({ ok: false, error, ...extra });
  process.exit(1);
}

function findPlanFile(plansDir: string): string | null {
  if (!existsSync(plansDir)) return null;
  try {
    const entries = readdirSync(plansDir);
    const md = entries.find((f) => f.endsWith(".md") && f !== "archive");
    return md ? join(plansDir, md) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const mainRoot = process.cwd();
  const name = args.worktree;

  if (!isGitRepo(mainRoot)) {
    fail(`Current directory is not a git repository: ${mainRoot}`);
  }

  const worktreePath = resolve(mainRoot, ".worktrees", name);
  if (!existsSync(worktreePath)) {
    fail(`Worktree not found: .worktrees/${name}`, { worktreePath });
  }

  // Verify it's a registered worktree
  const wtList = git(mainRoot, ["worktree", "list", "--porcelain"]);
  const registered = wtList.stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9).trim());
  const normalizedWt = resolve(worktreePath).replaceAll("\\", "/");
  const isRegistered = registered.some((p) => resolve(p).replaceAll("\\", "/") === normalizedWt);
  if (!isRegistered) {
    fail(`Path exists but is not a registered git worktree: ${worktreePath}`);
  }

  // Resolve worktree branch
  const branchResult = git(worktreePath, ["branch", "--show-current"]);
  if (branchResult.exitCode !== 0 || !branchResult.stdout) {
    fail(`Failed to resolve worktree branch: ${branchResult.stderr}`);
  }
  const worktreeBranch = branchResult.stdout;

  // Resolve main branch (uses origin/HEAD then main/master)
  const mainBranch = getMainBranch();
  log(`Main branch: ${mainBranch}, worktree branch: ${worktreeBranch}`);

  // --- Step 4: rebase ---
  if (!args["no-rebase"]) {
    log("Fetching origin...");
    const fetch = git(worktreePath, ["fetch", "origin"]);
    if (fetch.exitCode !== 0) {
      log(`fetch failed (proceeding with local ref): ${fetch.stderr}`);
    }

    const rebaseTarget = fetch.exitCode === 0 ? `origin/${mainBranch}` : mainBranch;
    log(`Rebasing onto ${rebaseTarget}...`);
    const rebase = git(worktreePath, ["rebase", rebaseTarget]);
    if (rebase.exitCode !== 0) {
      // Collect conflict files then abort
      const status = git(worktreePath, ["status", "--porcelain"]);
      const conflicts = status.stdout
        .split("\n")
        .filter((l) => l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DU") || l.startsWith("UD"))
        .map((l) => l.slice(3));
      git(worktreePath, ["rebase", "--abort"]);
      fail(`Rebase conflict against ${rebaseTarget}`, {
        conflictFiles: conflicts,
        worktreeBranch,
        mainBranch,
      });
    }
    log("Rebase successful.");
  } else {
    log("Skipping rebase (--no-rebase).");
  }

  // --- Step 5: check-project ---
  if (!args["dry-run"]) {
    log("Running check-project --quick...");
    const scriptDir = import.meta.dirname;
    const checkScript = join(scriptDir, "check-project.ts");
    const checkProc = Bun.spawnSync(["bun", checkScript, worktreePath, "--quick"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const checkText = checkProc.stdout.toString("utf-8").trim();
    let checkJson: Record<string, string> = {};
    try {
      checkJson = JSON.parse(checkText);
    } catch {
      fail("Failed to parse check-project output", { raw: checkText });
    }

    const failures: Record<string, string> = {};
    for (const key of ["typecheck", "build"]) {
      const val = checkJson[key];
      if (val && val !== "pass" && val !== "skip") {
        failures[key] = val;
      }
    }
    if (Object.keys(failures).length > 0) {
      fail("check-project failures", { failures, checks: checkJson });
    }
    log("check-project passed.");
  } else {
    log("Skipping check-project (--dry-run).");
  }

  // --- Step 6: stats ---
  const commitsCountResult = git(mainRoot, ["rev-list", "--count", `${mainBranch}..${worktreeBranch}`]);
  const commitsIntegrated = parseInt(commitsCountResult.stdout, 10) || 0;

  const diffNames = git(mainRoot, ["diff", "--name-only", `${mainBranch}...${worktreeBranch}`]);
  const filesChangedList = diffNames.stdout ? diffNames.stdout.split("\n").filter(Boolean) : [];
  const filesChanged = filesChangedList.length;

  const shortstat = git(mainRoot, ["diff", "--shortstat", `${mainBranch}...${worktreeBranch}`]);
  const statsMatch = shortstat.stdout.match(/(\d+)\s+insertion.*?(\d+)\s+deletion/);
  const additions = statsMatch ? parseInt(statsMatch[1], 10) : 0;
  const deletions = statsMatch ? parseInt(statsMatch[2], 10) : 0;

  // --- Step 7: plan file ---
  const plansDir = join(worktreePath, ".devorch/plans");
  const planFile = findPlanFile(plansDir);
  let planTitle = basename(name);
  if (planFile) {
    const planContent = safeReadFile(planFile);
    if (planContent) {
      planTitle = extractPlanTitle(planContent);
    }
  }

  // --- Step 8: dry-run reports and stops ---
  if (args["dry-run"]) {
    emit({
      ok: true,
      dryRun: true,
      worktree: name,
      worktreePath,
      worktreeBranch,
      mainBranch,
      planTitle,
      planFile,
      commitsIntegrated,
      filesChanged,
      additions,
      deletions,
      squash: args.squash,
      keepBranch: args["keep-branch"],
    });
    return;
  }

  // --- Step 9: merge ---
  // Guard: main branch must be clean (ignoring untracked)
  const mainStatus = getUncommittedFiles(mainRoot).filter((l) => !l.startsWith("??"));
  if (mainStatus.length > 0) {
    fail("Main repo has uncommitted tracked changes — commit or stash first", {
      dirtyFiles: mainStatus,
    });
  }

  const currentBranch = git(mainRoot, ["branch", "--show-current"]).stdout;
  if (currentBranch !== mainBranch) {
    log(`Checking out ${mainBranch} (was on ${currentBranch})...`);
    const checkout = git(mainRoot, ["checkout", mainBranch]);
    if (checkout.exitCode !== 0) {
      fail(`Failed to checkout ${mainBranch}`, { stderr: checkout.stderr });
    }
  }

  const preMergeHead = git(mainRoot, ["rev-parse", "HEAD"]).stdout;
  let mergeCommitSha: string | null = null;
  let squashHint: string | null = null;

  if (args.squash) {
    log(`Squash merging ${worktreeBranch}...`);
    const squash = git(mainRoot, ["merge", "--squash", worktreeBranch]);
    if (squash.exitCode !== 0) {
      fail(`Squash merge failed: ${squash.stderr}`);
    }
    squashHint = `Squash applied. Run 'git commit' with a summarizing message (plan: ${planTitle}, ${commitsIntegrated} commits, ${filesChanged} files). Cleanup skipped until commit.`;
    log(squashHint);
    emit({
      ok: true,
      merged: null,
      squash: true,
      hint: squashHint,
      worktree: name,
      worktreePath,
      worktreeBranch,
      planTitle,
      commitsIntegrated,
      filesChanged,
      additions,
      deletions,
      worktreeRemoved: false,
      branchDeleted: false,
      planArchivedTo: null,
    });
    return;
  }

  const mergeMsg = `merge(plan/${planTitle}): ${commitsIntegrated} commits across ${filesChanged} files`;
  log(`Merging ${worktreeBranch} → ${mainBranch} (--no-ff)...`);
  const merge = git(mainRoot, ["merge", "--no-ff", worktreeBranch, "-m", mergeMsg]);
  if (merge.exitCode !== 0) {
    const status = git(mainRoot, ["status", "--porcelain"]);
    const conflicts = status.stdout
      .split("\n")
      .filter((l) => l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DU") || l.startsWith("UD"))
      .map((l) => l.slice(3));
    git(mainRoot, ["merge", "--abort"]);
    fail("Merge failed", { conflictFiles: conflicts, stderr: merge.stderr });
  }
  mergeCommitSha = git(mainRoot, ["rev-parse", "HEAD"]).stdout;
  if (mergeCommitSha === preMergeHead) {
    // fast-forward blocked by --no-ff should never happen; sanity guard
    fail("Merge produced no new commit");
  }
  log(`Merge commit: ${mergeCommitSha}`);

  // --- Step 10: archive plan BEFORE removing worktree ---
  let planArchivedTo: string | null = null;
  if (planFile && existsSync(planFile)) {
    const archiveScript = join(import.meta.dirname, "archive-plan.ts");
    const archiveProc = Bun.spawnSync(
      ["bun", archiveScript, "--plan", planFile, "--target-root", mainRoot],
      { stdout: "pipe", stderr: "pipe" },
    );
    const archiveText = archiveProc.stdout.toString("utf-8").trim();
    if (archiveProc.exitCode === 0) {
      try {
        const parsed = JSON.parse(archiveText);
        planArchivedTo = parsed.to || null;
        log(`Plan archived to ${planArchivedTo}`);
      } catch {
        log(`archive-plan returned non-JSON: ${archiveText}`);
      }
    } else {
      log(`archive-plan failed: ${archiveProc.stderr.toString("utf-8").trim()}`);
    }
  }

  // --- Cleanup: worktree ---
  let worktreeRemoved = false;
  const wtRemove = git(mainRoot, ["worktree", "remove", worktreePath]);
  if (wtRemove.exitCode === 0) {
    worktreeRemoved = true;
  } else {
    log(`worktree remove failed (${wtRemove.stderr}); retrying with --force`);
    const forced = git(mainRoot, ["worktree", "remove", "--force", worktreePath]);
    worktreeRemoved = forced.exitCode === 0;
    if (!worktreeRemoved) {
      log(`worktree remove --force also failed: ${forced.stderr}`);
    }
  }

  // --- Cleanup: branch ---
  let branchDeleted = false;
  if (!args["keep-branch"]) {
    const del = git(mainRoot, ["branch", "-d", worktreeBranch]);
    if (del.exitCode === 0) {
      branchDeleted = true;
    } else {
      const forced = git(mainRoot, ["branch", "-D", worktreeBranch]);
      branchDeleted = forced.exitCode === 0;
      if (!branchDeleted) {
        log(`branch delete failed: ${forced.stderr}`);
      }
    }
  }

  emit({
    ok: true,
    merged: mergeCommitSha,
    filesChanged,
    commitsIntegrated,
    additions,
    deletions,
    worktree: name,
    worktreeBranch,
    mainBranch,
    planTitle,
    worktreeRemoved,
    branchDeleted,
    planArchivedTo,
  });
}

main().catch((err) => {
  console.error(`Unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
  emit({ ok: false, error: "unexpected", detail: err instanceof Error ? err.message : String(err) });
  process.exit(2);
});
