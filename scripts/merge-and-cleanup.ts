/**
 * merge-and-cleanup.ts — Atomic merge of a devorch worktree back to mainRoot.
 *
 * Pipeline:
 *   1. fetch origin (best-effort)
 *   2. rebase worktree onto <originalBranch> (or origin/<originalBranch> if remote exists)
 *   3. quick check-project (lint+typecheck) post-rebase
 *   4. dry-run merge (--no-commit --no-ff) — bail if it conflicts
 *   5. abort dry-run, then real merge --no-ff with the plan title as the commit message
 *   6. cleanup: remove worktree, delete devorch/<name> branch
 *
 * Conflict resolution stays with the orchestrator: if rebase or merge
 * fails on conflicts, the script exits with a structured payload listing
 * the conflicted files. The orchestrator resolves them semantically and
 * resumes the operation manually (the script does NOT loop).
 *
 * Usage: bun ~/.claude/devorch-scripts/merge-and-cleanup.ts \
 *          --worktree <path> --branch <devorch/name> --target <originalBranch> \
 *          --plan-title "<title>" [--main-root <path>] [--no-fetch]
 *          [--phase rebase|merge|cleanup]
 *
 * --phase lets the orchestrator resume after manual conflict resolution:
 *   --phase rebase   → start at step 1 (default)
 *   --phase merge    → skip rebase + sanity check, go to dry-run + merge
 *   --phase cleanup  → skip merge, just remove worktree + delete branch
 *
 * Output: JSON {ok, phase, ...details}
 *   On conflict: {ok: false, phase: "rebase"|"merge", conflictFiles: [...]}
 */
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{
  worktree: string;
  branch: string;
  target: string;
  "plan-title": string;
  "main-root": string;
  "no-fetch": boolean;
  phase: string;
}>([
  { name: "worktree", type: "string", required: true },
  { name: "branch", type: "string", required: true },
  { name: "target", type: "string", required: true },
  { name: "plan-title", type: "string", required: true },
  { name: "main-root", type: "string", required: false },
  { name: "no-fetch", type: "boolean", required: false },
  { name: "phase", type: "string", required: false },
]);

const worktreePath = resolve(args.worktree);
const branch = args.branch;
const target = args.target;
const planTitle = args["plan-title"];
const mainRoot = args["main-root"] ? resolve(args["main-root"]) : resolve(worktreePath, "../..");
const startPhase = (args.phase || "rebase") as "rebase" | "merge" | "cleanup";
const noFetch = args["no-fetch"];

interface CmdResult { ok: boolean; stdout: string; stderr: string; exit: number; }

function run(cwd: string, ...cmd: string[]): CmdResult {
  const proc = Bun.spawnSync(cmd, { cwd, stderr: "pipe", stdout: "pipe" });
  return {
    ok: proc.exitCode === 0,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
    exit: proc.exitCode || 0,
  };
}

function getConflictFiles(cwd: string): string[] {
  const r = run(cwd, "git", "diff", "--name-only", "--diff-filter=U");
  return r.ok && r.stdout ? r.stdout.split("\n").filter(Boolean) : [];
}

function emit(obj: Record<string, unknown>): never {
  console.log(JSON.stringify(obj));
  process.exit(0);
}

if (!existsSync(worktreePath)) {
  emit({ ok: false, phase: "preflight", error: `Worktree not found: ${worktreePath}` });
}

// Detect remote
const hasOrigin = run(mainRoot, "git", "remote", "get-url", "origin").ok;
const rebaseTarget = hasOrigin ? `origin/${target}` : target;

// ===== Phase: rebase =====

if (startPhase === "rebase") {
  // Bail early if worktree has uncommitted/conflicted state
  const status = run(worktreePath, "git", "status", "--porcelain");
  const conflictsExisting = getConflictFiles(worktreePath);
  if (conflictsExisting.length > 0) {
    emit({ ok: false, phase: "rebase", error: "Worktree has unresolved conflicts before rebase", conflictFiles: conflictsExisting });
  }
  if (status.stdout) {
    emit({ ok: false, phase: "rebase", error: "Worktree has uncommitted changes — commit or stash before merging", dirty: status.stdout.split("\n") });
  }

  if (hasOrigin && !noFetch) {
    const fetch = run(mainRoot, "git", "fetch", "origin", target);
    if (!fetch.ok) {
      emit({ ok: false, phase: "rebase", error: `git fetch origin ${target} failed: ${fetch.stderr}` });
    }
  }

  const rebase = run(worktreePath, "git", "rebase", rebaseTarget);
  if (!rebase.ok) {
    const conflictFiles = getConflictFiles(worktreePath);
    emit({
      ok: false,
      phase: "rebase",
      conflictFiles,
      hint: "Resolve conflicts in the worktree, then re-run with --phase merge.",
      stderr: rebase.stderr.slice(0, 500),
    });
  }
}

// ===== Phase: sanity check (only after rebase) =====

if (startPhase !== "cleanup") {
  // We always run a quick sanity check before merging
  const check = run(worktreePath, "bun", `${process.env.HOME}/.claude/devorch-scripts/check-project.ts`, worktreePath, "--quick");
  let checkPayload: Record<string, unknown> | null = null;
  try { checkPayload = JSON.parse(check.stdout); } catch {}
  if (checkPayload && (checkPayload.lint?.toString().startsWith("fail") || checkPayload.typecheck?.toString().startsWith("fail") || checkPayload.build?.toString().startsWith("fail"))) {
    emit({ ok: false, phase: "sanity-check", check: checkPayload, hint: "Fix the failing checks in the worktree, then re-run with --phase merge." });
  }
}

// ===== Phase: merge (dry-run + real) =====

if (startPhase === "rebase" || startPhase === "merge") {
  // Dry-run: --no-commit --no-ff. If conflicts, abort and report.
  const dryRun = run(mainRoot, "git", "merge", "--no-commit", "--no-ff", branch, "-m", `merge(devorch): ${planTitle}`);
  if (!dryRun.ok) {
    const conflictFiles = getConflictFiles(mainRoot);
    // Abort the partial merge
    run(mainRoot, "git", "merge", "--abort");
    emit({
      ok: false,
      phase: "merge",
      conflictFiles,
      hint: "Resolve conflicts in mainRoot, stage them, then `git -C <mainRoot> commit -m 'merge(devorch): <title>'` and re-run with --phase cleanup.",
      stderr: dryRun.stderr.slice(0, 500),
    });
  }

  // Dry-run cleared — finalize the merge with a real commit (already staged via --no-commit)
  const commit = run(mainRoot, "git", "commit", "--no-edit");
  if (!commit.ok) {
    emit({ ok: false, phase: "merge", error: "git commit failed", stderr: commit.stderr.slice(0, 500) });
  }
}

// ===== Phase: cleanup =====

const removeWt = run(mainRoot, "git", "worktree", "remove", worktreePath);
let worktreeRemoved = removeWt.ok;
let worktreeRemoveError: string | undefined;
if (!removeWt.ok) {
  // Try with --force as fallback (e.g., dirty submodules)
  const force = run(mainRoot, "git", "worktree", "remove", "--force", worktreePath);
  worktreeRemoved = force.ok;
  if (!force.ok) worktreeRemoveError = force.stderr;
}

const deleteBranch = run(mainRoot, "git", "branch", "-d", branch);
let branchDeleted = deleteBranch.ok;
let branchDeleteError: string | undefined;
if (!deleteBranch.ok) {
  // Branch may need -D after a rebase that left dangling commits unreachable from a refspec
  const force = run(mainRoot, "git", "branch", "-D", branch);
  branchDeleted = force.ok;
  if (!force.ok) branchDeleteError = force.stderr;
}

emit({
  ok: worktreeRemoved && branchDeleted,
  phase: "cleanup",
  worktreeRemoved,
  branchDeleted,
  worktreeRemoveError,
  branchDeleteError,
});
