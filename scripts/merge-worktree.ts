/**
 * merge-worktree.ts — Atomic merge of a devorch worktree branch into the main branch.
 * Unifies with-satellites and without-satellites merge paths into a single script.
 *
 * Usage: bun ~/.claude/devorch-scripts/merge-worktree.ts \
 *   --worktree-path <abs-path> \
 *   --main-root <abs-path> \
 *   --original-branch <branch> \
 *   --branch-name <branch> \
 *   [--satellites '<json>'] \
 *   [--skip-worktree-remove]
 *
 * Output: JSON to stdout, human-readable messages to stderr.
 */
import { existsSync, unlinkSync, readdirSync } from "fs";
import { join, basename } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{
  "worktree-path": string;
  "main-root": string;
  "original-branch": string;
  "branch-name": string;
  satellites: string;
  "skip-worktree-remove": boolean;
}>([
  { name: "worktree-path", type: "string", required: true },
  { name: "main-root", type: "string", required: true },
  { name: "original-branch", type: "string", required: true },
  { name: "branch-name", type: "string", required: true },
  { name: "satellites", type: "string", required: false },
  { name: "skip-worktree-remove", type: "boolean", required: false },
]);

interface SatelliteInput {
  name: string;
  worktreePath: string;
  mainRoot: string;
  branch: string;
}

interface RepoInfo {
  name: string;
  mainRoot: string;
  branch: string;
  worktreePath: string;
  stashed: boolean;
}

interface MergeResult {
  status: "success" | "conflict" | "stash-conflict" | "error";
  mergedRepos: string[];
  filesChanged: string[];
  stashed: boolean;
  stashRestored: boolean;
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  selfBuildNeeded: boolean;
  migrationJournalFixed: boolean;
  error: string | null;
  conflictRepo: string | null;
  conflictFiles: string[];
}

function git(repoPath: string, gitArgs: string[]): { exitCode: number; stdout: string; stderr: string } {
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

function output(result: MergeResult): void {
  console.log(JSON.stringify(result, null, 2));
}

function stashRepo(repo: RepoInfo): boolean {
  const status = git(repo.mainRoot, ["status", "--porcelain"]);
  const trackedChanges = status.stdout
    .split("\n")
    .filter((l) => l && !l.startsWith("??"));

  if (trackedChanges.length === 0) {
    repo.stashed = false;
    return true;
  }

  const stash = git(repo.mainRoot, ["stash", "push", "-m", "devorch-pre-merge", "--", ":!.devorch/"]);
  if (stash.exitCode !== 0) {
    log(`Failed to stash ${repo.name}: ${stash.stderr}`);
    return false;
  }
  repo.stashed = true;
  return true;
}

function restoreStash(repo: RepoInfo): { ok: boolean; conflictFiles: string[] } {
  if (!repo.stashed) return { ok: true, conflictFiles: [] };

  const pop = git(repo.mainRoot, ["stash", "pop"]);
  if (pop.exitCode !== 0) {
    const status = git(repo.mainRoot, ["status", "--porcelain"]);
    const conflicts = status.stdout
      .split("\n")
      .filter((l) => l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DU") || l.startsWith("UD"))
      .map((l) => l.slice(3));
    return { ok: false, conflictFiles: conflicts.length > 0 ? conflicts : [pop.stderr] };
  }
  return { ok: true, conflictFiles: [] };
}

function untrackedFileGuard(mainRoot: string, mainBranch: string, worktreeBranch: string): void {
  const incoming = git(mainRoot, ["diff", "--name-only", `${mainBranch}..${worktreeBranch}`]);
  const untracked = git(mainRoot, ["ls-files", "--others", "--exclude-standard"]);

  if (incoming.exitCode !== 0 || !incoming.stdout) return;

  const incomingFiles = new Set(incoming.stdout.split("\n").filter(Boolean));
  const untrackedFiles = untracked.stdout.split("\n").filter(Boolean);
  const conflicts = untrackedFiles.filter((f) => incomingFiles.has(f));

  if (conflicts.length > 0) {
    log(`Tracking ${conflicts.length} untracked file(s) that conflict with incoming branch`);
    git(mainRoot, ["add", ...conflicts]);
    git(mainRoot, ["commit", "-m", "chore: track files before devorch merge"]);
  }
}

function dryRunMerge(mainRoot: string, branch: string): { ok: boolean; conflictFiles: string[] } {
  const merge = git(mainRoot, ["merge", "--no-commit", "--no-ff", branch]);

  if (merge.exitCode !== 0) {
    // Collect conflict files before aborting
    const status = git(mainRoot, ["status", "--porcelain"]);
    const conflicts = status.stdout
      .split("\n")
      .filter((l) => l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DU") || l.startsWith("UD"))
      .map((l) => l.slice(3));
    git(mainRoot, ["merge", "--abort"]);
    return { ok: false, conflictFiles: conflicts };
  }

  git(mainRoot, ["merge", "--abort"]);
  return { ok: true, conflictFiles: [] };
}

function doMerge(mainRoot: string, originalBranch: string, worktreeBranch: string): boolean {
  const checkout = git(mainRoot, ["checkout", originalBranch]);
  if (checkout.exitCode !== 0) {
    log(`Failed to checkout ${originalBranch}: ${checkout.stderr}`);
    return false;
  }

  const merge = git(mainRoot, ["merge", worktreeBranch]);
  if (merge.exitCode !== 0) {
    log(`Merge failed for ${worktreeBranch}: ${merge.stderr}`);
    return false;
  }

  return true;
}

function detectSelfBuild(mainRoot: string, originalBranch: string): boolean {
  const diff = git(mainRoot, ["diff", "--name-only", `${originalBranch}..HEAD`]);
  if (diff.exitCode !== 0 || !diff.stdout) return false;

  const selfBuildPrefixes = ["scripts/", "agents/", "commands/", "hooks/"];
  const changed = diff.stdout.split("\n").filter(Boolean);
  const hasDevFiles = changed.some((f) => selfBuildPrefixes.some((p) => f.startsWith(p)));
  const hasInstall = existsSync(join(mainRoot, "install.ts"));

  return hasDevFiles && hasInstall;
}

async function runFixMigrationJournal(mainRoot: string): Promise<boolean> {
  const drizzleCandidates = [
    "src/server/db/migrations/meta/_journal.json",
    "drizzle/meta/_journal.json",
    "migrations/meta/_journal.json",
    "db/migrations/meta/_journal.json",
  ];
  const hasDrizzle = drizzleCandidates.some((c) => existsSync(join(mainRoot, c)));
  if (!hasDrizzle) return false;

  const scriptDir = import.meta.dirname;
  const scriptPath = join(scriptDir, "fix-migration-journal.ts");
  if (!existsSync(scriptPath)) return false;

  const proc = Bun.spawn(["bun", scriptPath, "--root", mainRoot], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;

  try {
    const result = JSON.parse(text.trim());
    if (result.fixed > 0) {
      log(`Fixed ${result.fixed} migration journal entries`);
      return true;
    }
  } catch {
    // ignore parse errors
  }
  return false;
}

async function runArchivePlan(worktreePath: string, mainRoot: string): Promise<void> {
  const plansDir = join(worktreePath, ".devorch/plans");
  if (!existsSync(plansDir)) return;

  let planFile = "";
  try {
    const entries = readdirSync(plansDir);
    const md = entries.find((f) => f.endsWith(".md") && f !== "archive");
    if (md) planFile = join(plansDir, md);
  } catch {
    // ignore
  }

  if (!planFile && existsSync(join(plansDir, "current.md"))) {
    planFile = join(plansDir, "current.md");
  }

  if (!planFile || !existsSync(planFile)) return;

  const scriptDir = import.meta.dirname;
  const scriptPath = join(scriptDir, "archive-plan.ts");
  if (!existsSync(scriptPath)) return;

  const proc = Bun.spawn(["bun", scriptPath, "--plan", planFile, "--target-root", mainRoot], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await new Response(proc.stdout).text();
  await proc.exited;
  log("Plan archived");
}

function cleanupStateFiles(mainRoot: string, worktreeName: string): void {
  const devorch = join(mainRoot, ".devorch");

  const stateFile = join(devorch, "state.md");
  if (existsSync(stateFile)) unlinkSync(stateFile);

  // Delete explore-cache files
  const cacheName = worktreeName;
  const cacheFile = join(devorch, `explore-cache-${cacheName}.md`);
  if (existsSync(cacheFile)) unlinkSync(cacheFile);

  // Backward compat cleanup
  const legacyCache = join(devorch, "explore-cache.md");
  if (existsSync(legacyCache)) unlinkSync(legacyCache);

  // Delete project-map
  const projectMap = join(devorch, "project-map.md");
  if (existsSync(projectMap)) unlinkSync(projectMap);
}

function commitCleanup(mainRoot: string, planName: string): void {
  const status = git(mainRoot, ["status", "--porcelain", ".devorch/"]);
  if (status.stdout) {
    git(mainRoot, ["add", ".devorch/"]);
    git(mainRoot, ["commit", "-m", `chore(devorch): cleanup post-merge ${planName}`]);
  }
}

function removeWorktree(mainRoot: string, worktreePath: string, branchName: string): { removed: boolean; branchDeleted: boolean } {
  const remove = git(mainRoot, ["worktree", "remove", "--force", worktreePath]);
  const removed = remove.exitCode === 0;
  if (!removed) {
    log(`Failed to remove worktree: ${remove.stderr}`);
  }

  const branchDel = git(mainRoot, ["branch", "-d", branchName]);
  const branchDeleted = branchDel.exitCode === 0;
  if (!branchDeleted) {
    log(`Failed to delete branch ${branchName}: ${branchDel.stderr}`);
  }

  return { removed, branchDeleted };
}

// --- Main flow ---

async function main(): Promise<void> {
  const worktreePath = args["worktree-path"];
  const mainRoot = args["main-root"];
  const originalBranch = args["original-branch"];
  const branchName = args["branch-name"];
  const skipWorktreeRemove = args["skip-worktree-remove"];

  // Parse satellites
  let satellites: SatelliteInput[] = [];
  if (args.satellites) {
    try {
      satellites = JSON.parse(args.satellites);
    } catch {
      output({
        status: "error",
        mergedRepos: [],
        filesChanged: [],
        stashed: false,
        stashRestored: false,
        worktreeRemoved: false,
        branchDeleted: false,
        selfBuildNeeded: false,
        migrationJournalFixed: false,
        error: "Failed to parse --satellites JSON",
        conflictRepo: null,
        conflictFiles: [],
      });
      return;
    }
  }

  // Build repo list: primary + satellites
  const primaryRepo: RepoInfo = {
    name: "primary",
    mainRoot,
    branch: branchName,
    worktreePath,
    stashed: false,
  };

  const satelliteRepos: RepoInfo[] = satellites.map((s) => ({
    name: s.name,
    mainRoot: s.mainRoot,
    branch: s.branch,
    worktreePath: s.worktreePath,
    stashed: false,
  }));

  const allRepos = [primaryRepo, ...satelliteRepos];

  // Derive plan name from worktree path (last segment)
  const worktreeName = basename(worktreePath);

  // 1. Pre-flight stash
  log("Pre-flight: stashing dirty repos...");
  const stashedRepos: RepoInfo[] = [];
  for (const repo of allRepos) {
    if (!stashRepo(repo)) {
      // Restore any already-stashed repos
      for (const sr of stashedRepos) {
        restoreStash(sr);
      }
      output({
        status: "error",
        mergedRepos: [],
        filesChanged: [],
        stashed: false,
        stashRestored: false,
        worktreeRemoved: false,
        branchDeleted: false,
        selfBuildNeeded: false,
        migrationJournalFixed: false,
        error: `Failed to stash ${repo.name}`,
        conflictRepo: repo.name,
        conflictFiles: [],
      });
      return;
    }
    if (repo.stashed) stashedRepos.push(repo);
  }

  const anyStashed = stashedRepos.length > 0;
  if (anyStashed) {
    log(`Stashed changes in ${stashedRepos.length} repo(s): ${stashedRepos.map((r) => r.name).join(", ")}`);
  } else {
    log("All repos clean, proceeding.");
  }

  // 2. Untracked file guard (primary only)
  untrackedFileGuard(mainRoot, originalBranch, branchName);

  // 3. Dry-run ALL repos (atomicity: all must pass before any merge)
  log("Dry-run merge on all repos...");
  for (const repo of allRepos) {
    const dryRun = dryRunMerge(repo.mainRoot, repo.branch);
    if (!dryRun.ok) {
      log(`Dry-run conflict in ${repo.name}`);
      // Restore all stashed repos
      for (const sr of stashedRepos) {
        restoreStash(sr);
      }
      output({
        status: "conflict",
        mergedRepos: [],
        filesChanged: [],
        stashed: anyStashed,
        stashRestored: anyStashed,
        worktreeRemoved: false,
        branchDeleted: false,
        selfBuildNeeded: false,
        migrationJournalFixed: false,
        error: `Dry-run merge conflict in ${repo.name}`,
        conflictRepo: repo.name,
        conflictFiles: dryRun.conflictFiles,
      });
      return;
    }
  }
  log("All dry-runs passed.");

  // 4. Merge all repos (primary first, then satellites)
  const mergedRepos: string[] = [];
  for (const repo of allRepos) {
    const ok = doMerge(repo.mainRoot, originalBranch, repo.branch);
    if (!ok) {
      // Partial failure — restore stash in already-merged + remaining repos
      for (const sr of stashedRepos) {
        restoreStash(sr);
      }
      output({
        status: "error",
        mergedRepos,
        filesChanged: [],
        stashed: anyStashed,
        stashRestored: anyStashed,
        worktreeRemoved: false,
        branchDeleted: false,
        selfBuildNeeded: false,
        migrationJournalFixed: false,
        error: `Merge failed in ${repo.name}`,
        conflictRepo: repo.name,
        conflictFiles: [],
      });
      return;
    }
    mergedRepos.push(repo.name);
  }
  log(`Merged ${mergedRepos.length} repo(s): ${mergedRepos.join(", ")}`);

  // 5. Restore stashed changes
  let stashRestored = true;
  for (const repo of stashedRepos) {
    const result = restoreStash(repo);
    if (!result.ok) {
      output({
        status: "stash-conflict",
        mergedRepos,
        filesChanged: [],
        stashed: true,
        stashRestored: false,
        worktreeRemoved: false,
        branchDeleted: false,
        selfBuildNeeded: false,
        migrationJournalFixed: false,
        error: `Stash pop conflict in ${repo.name}`,
        conflictRepo: repo.name,
        conflictFiles: result.conflictFiles,
      });
      return;
    }
  }
  if (anyStashed) log("Stash restored in all repos.");

  // 6. Get changed files (primary repo)
  const diffResult = git(mainRoot, ["diff", "--name-only", `${originalBranch}..HEAD`]);
  const filesChanged = diffResult.stdout ? diffResult.stdout.split("\n").filter(Boolean) : [];

  // 7. Self-build detection
  const selfBuildNeeded = detectSelfBuild(mainRoot, originalBranch);
  if (selfBuildNeeded) {
    log("devorch scripts updated — running install");
    const installProc = Bun.spawnSync(["bun", "run", "install"], {
      cwd: mainRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (installProc.exitCode !== 0) {
      log(`Install failed: ${installProc.stderr.toString("utf-8").trim()}`);
    }
  }

  // 8. Fix migration journal
  const migrationJournalFixed = await runFixMigrationJournal(mainRoot);

  // 9. Archive plan
  await runArchivePlan(worktreePath, mainRoot);

  // 10. Cleanup state files
  cleanupStateFiles(mainRoot, worktreeName);

  // 11. Commit cleanup
  const planName = worktreeName;
  commitCleanup(mainRoot, planName);

  // 12. Remove worktree and delete branch (all repos)
  let worktreeRemoved = true;
  let branchDeleted = true;

  if (!skipWorktreeRemove) {
    for (const repo of allRepos) {
      const cleanup = removeWorktree(repo.mainRoot, repo.worktreePath, repo.branch);
      if (!cleanup.removed) worktreeRemoved = false;
      if (!cleanup.branchDeleted) branchDeleted = false;
    }
    log(`Worktrees and branches cleaned up.`);
  } else {
    worktreeRemoved = false;
    branchDeleted = false;
    log("Skipping worktree removal (--skip-worktree-remove).");
  }

  output({
    status: "success",
    mergedRepos,
    filesChanged,
    stashed: anyStashed,
    stashRestored,
    worktreeRemoved,
    branchDeleted,
    selfBuildNeeded,
    migrationJournalFixed,
    error: null,
    conflictRepo: null,
    conflictFiles: [],
  });
}

main();
