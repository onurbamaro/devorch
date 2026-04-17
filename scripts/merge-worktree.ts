/**
 * merge-worktree.ts — v3 merge flow for a devorch worktree (supports coordinated multi-repo merge).
 *
 * Flow (single-repo): rebase → check → stats → merge → cleanup → archive.
 * Flow (with --satellites): rebase each → check primary → stats each → dry-run ALL → merge ALL → cleanup each → archive primary.
 *
 * Usage: bun scripts/merge-worktree.ts --worktree <name> [--satellites '<json>'] [--squash] [--keep-branch] [--no-rebase] [--dry-run]
 * Satellites JSON: [{name, path, branch?}] — path is absolute sibling repo path; branch defaults to devorch/<worktree-name>.
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
  satellites: string;
  squash: boolean;
  "keep-branch": boolean;
  "no-rebase": boolean;
  "dry-run": boolean;
}

const args = parseArgs<Args>([
  { name: "worktree", type: "string", required: true },
  { name: "satellites", type: "string", required: false },
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

function collectConflictFiles(repoPath: string): string[] {
  const status = git(repoPath, ["status", "--porcelain"]);
  return status.stdout
    .split("\n")
    .filter(
      (l) =>
        l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DU") || l.startsWith("UD"),
    )
    .map((l) => l.slice(3));
}

/**
 * A single repo (primary or satellite) participating in the coordinated merge.
 * `repoMainPath` is where `main` lives and where merge/checkout occur.
 * `worktreePath` is the worktree dir to merge from.
 * `branch` is the branch to merge (lives inside worktreePath).
 */
interface RepoTarget {
  role: "primary" | "satellite";
  name: string;
  repoMainPath: string;
  worktreePath: string;
  branch: string;
  mainBranch: string;
}

interface RepoStats {
  commitsIntegrated: number;
  filesChanged: number;
  additions: number;
  deletions: number;
}

interface SatelliteInput {
  name: string;
  path: string;
  branch?: string;
}

function parseSatellites(jsonStr: string, primaryName: string): SatelliteInput[] {
  if (!jsonStr) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    fail("Failed to parse --satellites JSON", { raw: jsonStr });
  }
  if (!Array.isArray(parsed)) {
    fail("--satellites must be a JSON array");
  }
  const out: SatelliteInput[] = [];
  for (const entry of parsed as unknown[]) {
    if (!entry || typeof entry !== "object") {
      fail("--satellites entries must be objects with {name, path, branch?}");
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string" || typeof e.path !== "string") {
      fail("--satellites entries require string {name, path}", { entry: e });
    }
    const branch = typeof e.branch === "string" && e.branch ? e.branch : `devorch/${primaryName}`;
    out.push({ name: e.name, path: e.path, branch });
  }
  return out;
}

/**
 * Resolves a repo target — verifies it's a git repo, its worktree is registered,
 * and determines the worktree's current branch. If `expectedBranch` is provided,
 * the current branch must match it (satellites always pass this); otherwise the
 * branch is auto-detected (primary flow).
 */
function resolveRepo(
  role: "primary" | "satellite",
  name: string,
  repoMainPath: string,
  worktreePath: string,
  expectedBranch: string | null,
): RepoTarget {
  if (!isGitRepo(repoMainPath)) {
    fail(`Repo for ${role} "${name}" is not a git repository: ${repoMainPath}`);
  }
  if (!existsSync(worktreePath)) {
    fail(`Worktree for ${role} "${name}" not found: ${worktreePath}`);
  }
  const wtList = git(repoMainPath, ["worktree", "list", "--porcelain"]);
  const registered = wtList.stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9).trim());
  const normalizedWt = resolve(worktreePath).replaceAll("\\", "/");
  const isRegistered = registered.some(
    (p) => resolve(p).replaceAll("\\", "/") === normalizedWt,
  );
  if (!isRegistered) {
    fail(`Path exists but is not a registered git worktree in ${role} "${name}": ${worktreePath}`);
  }
  const branchCheck = git(worktreePath, ["branch", "--show-current"]);
  if (branchCheck.exitCode !== 0 || !branchCheck.stdout) {
    fail(`Failed to resolve worktree branch for ${role} "${name}": ${branchCheck.stderr}`);
  }
  const actualBranch = branchCheck.stdout;
  if (expectedBranch !== null && actualBranch !== expectedBranch) {
    fail(
      `Worktree branch mismatch for ${role} "${name}": expected ${expectedBranch}, got ${actualBranch}`,
    );
  }
  const mainBranch = getMainBranch(repoMainPath);
  return { role, name, repoMainPath, worktreePath, branch: actualBranch, mainBranch };
}

function rebaseRepo(repo: RepoTarget): { ok: true } | { ok: false; conflictFiles: string[]; target: string } {
  log(`[${repo.name}] Fetching origin...`);
  const fetch = git(repo.worktreePath, ["fetch", "origin"]);
  if (fetch.exitCode !== 0) {
    log(`[${repo.name}] fetch failed (proceeding with local ref): ${fetch.stderr}`);
  }
  const rebaseTarget = fetch.exitCode === 0 ? `origin/${repo.mainBranch}` : repo.mainBranch;
  log(`[${repo.name}] Rebasing onto ${rebaseTarget}...`);
  const rebase = git(repo.worktreePath, ["rebase", rebaseTarget]);
  if (rebase.exitCode !== 0) {
    const conflicts = collectConflictFiles(repo.worktreePath);
    git(repo.worktreePath, ["rebase", "--abort"]);
    return { ok: false, conflictFiles: conflicts, target: rebaseTarget };
  }
  log(`[${repo.name}] Rebase successful.`);
  return { ok: true };
}

function computeStats(repo: RepoTarget): RepoStats {
  const commitsCountResult = git(repo.repoMainPath, [
    "rev-list",
    "--count",
    `${repo.mainBranch}..${repo.branch}`,
  ]);
  const commitsIntegrated = parseInt(commitsCountResult.stdout, 10) || 0;

  const diffNames = git(repo.repoMainPath, [
    "diff",
    "--name-only",
    `${repo.mainBranch}...${repo.branch}`,
  ]);
  const filesChangedList = diffNames.stdout
    ? diffNames.stdout.split("\n").filter(Boolean)
    : [];
  const filesChanged = filesChangedList.length;

  const shortstat = git(repo.repoMainPath, [
    "diff",
    "--shortstat",
    `${repo.mainBranch}...${repo.branch}`,
  ]);
  const statsMatch = shortstat.stdout.match(/(\d+)\s+insertion.*?(\d+)\s+deletion/);
  const additions = statsMatch ? parseInt(statsMatch[1], 10) : 0;
  const deletions = statsMatch ? parseInt(statsMatch[2], 10) : 0;

  return { commitsIntegrated, filesChanged, additions, deletions };
}

/**
 * Ensures the repo is on its main branch with a clean tracked-index and returns
 * the previous branch (or null on failure). Caller proceeds only on ok=true.
 */
function ensureOnMainBranch(repo: RepoTarget): { ok: true } | { ok: false; reason: string } {
  const mainStatus = getUncommittedFiles(repo.repoMainPath).filter((l) => !l.startsWith("??"));
  if (mainStatus.length > 0) {
    return {
      ok: false,
      reason: `repo "${repo.name}" has uncommitted tracked changes: ${mainStatus.join(", ")}`,
    };
  }
  const currentBranch = git(repo.repoMainPath, ["branch", "--show-current"]).stdout;
  if (currentBranch !== repo.mainBranch) {
    log(`[${repo.name}] Checking out ${repo.mainBranch} (was on ${currentBranch})...`);
    const checkout = git(repo.repoMainPath, ["checkout", repo.mainBranch]);
    if (checkout.exitCode !== 0) {
      return { ok: false, reason: `failed to checkout ${repo.mainBranch}: ${checkout.stderr}` };
    }
  }
  return { ok: true };
}

interface DryRunOutcome {
  ok: boolean;
  conflictFiles: string[];
  reason?: string;
}

function dryRunMerge(repo: RepoTarget): DryRunOutcome {
  const ensured = ensureOnMainBranch(repo);
  if (!ensured.ok) {
    return { ok: false, conflictFiles: [], reason: ensured.reason };
  }
  const merge = git(repo.repoMainPath, ["merge", "--no-commit", "--no-ff", repo.branch]);
  const conflicts = merge.exitCode !== 0 ? collectConflictFiles(repo.repoMainPath) : [];
  // Always abort to reset index/working tree (also clears the "merging" state
  // when merge succeeded without conflicts but was --no-commit).
  git(repo.repoMainPath, ["merge", "--abort"]);
  if (merge.exitCode !== 0) {
    return { ok: false, conflictFiles: conflicts, reason: merge.stderr };
  }
  return { ok: true, conflictFiles: [] };
}

interface MergeOutcome {
  ok: boolean;
  sha: string | null;
  squash: boolean;
  reason?: string;
  conflictFiles?: string[];
}

function mergeRepo(repo: RepoTarget, mergeMsg: string, squash: boolean): MergeOutcome {
  const ensured = ensureOnMainBranch(repo);
  if (!ensured.ok) {
    return { ok: false, sha: null, squash, reason: ensured.reason };
  }
  if (squash) {
    const sq = git(repo.repoMainPath, ["merge", "--squash", repo.branch]);
    if (sq.exitCode !== 0) {
      return { ok: false, sha: null, squash, reason: `squash merge failed: ${sq.stderr}` };
    }
    return { ok: true, sha: null, squash };
  }
  const preMergeHead = git(repo.repoMainPath, ["rev-parse", "HEAD"]).stdout;
  const merge = git(repo.repoMainPath, ["merge", "--no-ff", repo.branch, "-m", mergeMsg]);
  if (merge.exitCode !== 0) {
    const conflicts = collectConflictFiles(repo.repoMainPath);
    git(repo.repoMainPath, ["merge", "--abort"]);
    return { ok: false, sha: null, squash, reason: merge.stderr, conflictFiles: conflicts };
  }
  const sha = git(repo.repoMainPath, ["rev-parse", "HEAD"]).stdout;
  if (sha === preMergeHead) {
    return { ok: false, sha: null, squash, reason: "merge produced no new commit" };
  }
  return { ok: true, sha, squash };
}

interface CleanupOutcome {
  worktreeRemoved: boolean;
  branchDeleted: boolean;
}

function cleanupRepo(repo: RepoTarget, keepBranch: boolean): CleanupOutcome {
  let worktreeRemoved = false;
  const wtRemove = git(repo.repoMainPath, ["worktree", "remove", repo.worktreePath]);
  if (wtRemove.exitCode === 0) {
    worktreeRemoved = true;
  } else {
    log(`[${repo.name}] worktree remove failed (${wtRemove.stderr}); retrying with --force`);
    const forced = git(repo.repoMainPath, ["worktree", "remove", "--force", repo.worktreePath]);
    worktreeRemoved = forced.exitCode === 0;
    if (!worktreeRemoved) {
      log(`[${repo.name}] worktree remove --force also failed: ${forced.stderr}`);
    }
  }

  let branchDeleted = false;
  if (!keepBranch) {
    const del = git(repo.repoMainPath, ["branch", "-d", repo.branch]);
    if (del.exitCode === 0) {
      branchDeleted = true;
    } else {
      const forced = git(repo.repoMainPath, ["branch", "-D", repo.branch]);
      branchDeleted = forced.exitCode === 0;
      if (!branchDeleted) {
        log(`[${repo.name}] branch delete failed: ${forced.stderr}`);
      }
    }
  }
  return { worktreeRemoved, branchDeleted };
}

async function main(): Promise<void> {
  const mainRoot = process.cwd();
  const name = args.worktree;

  if (!isGitRepo(mainRoot)) {
    fail(`Current directory is not a git repository: ${mainRoot}`);
  }

  const worktreePath = resolve(mainRoot, ".worktrees", name);
  // Primary: auto-detect branch (whatever is checked out in the worktree).
  const primary = resolveRepo("primary", name, mainRoot, worktreePath, null);

  log(`[primary:${primary.name}] Main branch: ${primary.mainBranch}, worktree branch: ${primary.branch}`);

  // Parse and resolve satellites (if any)
  const satelliteInputs = parseSatellites(args.satellites, name);
  const satellites: RepoTarget[] = [];
  for (const sat of satelliteInputs) {
    const satRepoMain = resolve(sat.path);
    const satWorktreePath = join(satRepoMain, ".worktrees", name);
    const satBranch = sat.branch ?? `devorch/${name}`;
    const resolved = resolveRepo("satellite", sat.name, satRepoMain, satWorktreePath, satBranch);
    log(`[satellite:${resolved.name}] Main branch: ${resolved.mainBranch}, worktree branch: ${resolved.branch}`);
    satellites.push(resolved);
  }

  const repos: RepoTarget[] = [primary, ...satellites];

  // --- Rebase each repo independently ---
  if (!args["no-rebase"]) {
    for (const repo of repos) {
      const res = rebaseRepo(repo);
      if (!res.ok) {
        fail(`Rebase conflict in ${repo.role} "${repo.name}" against ${res.target}`, {
          phase: "rebase",
          failedRepos: [
            {
              role: repo.role,
              name: repo.name,
              path: repo.repoMainPath,
              reason: "rebase-conflict",
              conflictFiles: res.conflictFiles,
            },
          ],
        });
      }
    }
  } else {
    log("Skipping rebase (--no-rebase).");
  }

  // --- check-project --quick on PRIMARY only ---
  // Satellites are expected to be self-validated by their builder agents — running
  // check-project per satellite here would explode latency and duplicate coverage.
  if (!args["dry-run"]) {
    log("Running check-project --quick on primary...");
    const scriptDir = import.meta.dirname;
    const checkScript = join(scriptDir, "check-project.ts");
    const checkProc = Bun.spawnSync(["bun", checkScript, primary.worktreePath, "--quick"], {
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

  // --- Stats per repo ---
  const statsByRepo = new Map<string, RepoStats>();
  for (const repo of repos) {
    statsByRepo.set(repo.name, computeStats(repo));
  }
  const primaryStats = statsByRepo.get(primary.name)!;

  // --- Plan file (primary only) ---
  const plansDir = join(primary.worktreePath, ".devorch/plans");
  const planFile = findPlanFile(plansDir);
  let planTitle = basename(name);
  if (planFile) {
    const planContent = safeReadFile(planFile);
    if (planContent) {
      planTitle = extractPlanTitle(planContent);
    }
  }

  // --- Dry-run reports and stops ---
  if (args["dry-run"]) {
    const repoReports = repos.map((r) => {
      const s = statsByRepo.get(r.name)!;
      return {
        role: r.role,
        name: r.name,
        path: r.repoMainPath,
        worktreePath: r.worktreePath,
        branch: r.branch,
        mainBranch: r.mainBranch,
        commitsIntegrated: s.commitsIntegrated,
        filesChanged: s.filesChanged,
        additions: s.additions,
        deletions: s.deletions,
      };
    });
    emit({
      ok: true,
      dryRun: true,
      worktree: name,
      planTitle,
      planFile,
      repos: repoReports,
      squash: args.squash,
      keepBranch: args["keep-branch"],
    });
    return;
  }

  // --- Dry-run ALL repos before committing any merge (atomicity guard) ---
  // Only meaningful when we actually have satellites; for single-repo, keep the
  // behavior equivalent to the prior implementation (direct merge + abort on conflict).
  // We use merge --no-commit --no-ff as the dry-run even when --squash was requested;
  // conflict surface is identical so this is a valid pre-flight.
  const hasSatellites = satellites.length > 0;
  if (hasSatellites) {
    log("Dry-run all repos before committing (atomicity guard)...");
    const dryResults = repos.map((repo) => ({ repo, outcome: dryRunMerge(repo) }));
    const failedDry = dryResults.filter((r) => !r.outcome.ok);
    if (failedDry.length > 0) {
      const okRepos = dryResults
        .filter((r) => r.outcome.ok)
        .map((r) => ({ role: r.repo.role, name: r.repo.name, path: r.repo.repoMainPath }));
      fail("Dry-run merge failed in one or more repos — no repo was merged", {
        phase: "dry-run",
        failedRepos: failedDry.map((r) => ({
          role: r.repo.role,
          name: r.repo.name,
          path: r.repo.repoMainPath,
          reason: r.outcome.reason ?? "merge conflict",
          conflictFiles: r.outcome.conflictFiles,
        })),
        okRepos,
      });
    }
    log("All repos dry-ran cleanly. Proceeding to sequential merge.");
  }

  // --- Merge sequentially ---
  const mergeMsg = `merge(plan/${planTitle}): ${primaryStats.commitsIntegrated} commits across ${primaryStats.filesChanged} files`;

  const mergeResults: Array<{
    repo: RepoTarget;
    outcome: MergeOutcome;
  }> = [];

  for (const repo of repos) {
    log(`[${repo.name}] Merging ${repo.branch} → ${repo.mainBranch} (${args.squash ? "--squash" : "--no-ff"})...`);
    const outcome = mergeRepo(repo, mergeMsg, args.squash);
    mergeResults.push({ repo, outcome });
    if (!outcome.ok) {
      // Abort pipeline; earlier repos may have been merged already (can't rollback merge
      // commits safely without user intent). Report the partial state.
      const okRepos = mergeResults
        .filter((r) => r.outcome.ok)
        .map((r) => ({
          role: r.repo.role,
          name: r.repo.name,
          path: r.repo.repoMainPath,
          merged: r.outcome.sha,
        }));
      fail(`Merge failed in ${repo.role} "${repo.name}"`, {
        phase: "merge",
        failedRepos: [
          {
            role: repo.role,
            name: repo.name,
            path: repo.repoMainPath,
            reason: outcome.reason ?? "unknown",
            conflictFiles: outcome.conflictFiles ?? [],
          },
        ],
        okRepos,
      });
    }
    if (outcome.sha) {
      log(`[${repo.name}] Merge commit: ${outcome.sha}`);
    }
  }

  // --- Squash short-circuit: no cleanup / archive until user commits ---
  if (args.squash) {
    const squashHint = `Squash applied across ${repos.length} repo(s). Run 'git commit' per repo with a summarizing message (plan: ${planTitle}, ${primaryStats.commitsIntegrated} commits, ${primaryStats.filesChanged} files). Cleanup skipped until commit.`;
    log(squashHint);
    const squashReport = mergeResults.map(({ repo }) => {
      const s = statsByRepo.get(repo.name)!;
      return {
        role: repo.role,
        name: repo.name,
        path: repo.repoMainPath,
        merged: null,
        commitsIntegrated: s.commitsIntegrated,
        filesChanged: s.filesChanged,
        worktreeRemoved: false,
        branchDeleted: false,
      };
    });
    emit({
      ok: true,
      squash: true,
      hint: squashHint,
      worktree: name,
      planTitle,
      repos: squashReport,
      planArchivedTo: null,
    });
    return;
  }

  // --- Archive primary plan BEFORE removing primary worktree ---
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

  // --- Cleanup per repo ---
  const cleanupByRepo = new Map<string, CleanupOutcome>();
  for (const { repo } of mergeResults) {
    cleanupByRepo.set(repo.name, cleanupRepo(repo, args["keep-branch"]));
  }

  // --- Final JSON ---
  const reposReport = mergeResults.map(({ repo, outcome }) => {
    const s = statsByRepo.get(repo.name)!;
    const c = cleanupByRepo.get(repo.name)!;
    return {
      role: repo.role,
      name: repo.name,
      path: repo.repoMainPath,
      merged: outcome.sha,
      commitsIntegrated: s.commitsIntegrated,
      filesChanged: s.filesChanged,
      additions: s.additions,
      deletions: s.deletions,
      worktreeRemoved: c.worktreeRemoved,
      branchDeleted: c.branchDeleted,
    };
  });

  emit({
    ok: true,
    worktree: name,
    planTitle,
    repos: reposReport,
    planArchivedTo,
  });
}

main().catch((err) => {
  console.error(`Unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
  emit({ ok: false, error: "unexpected", detail: err instanceof Error ? err.message : String(err) });
  process.exit(2);
});
