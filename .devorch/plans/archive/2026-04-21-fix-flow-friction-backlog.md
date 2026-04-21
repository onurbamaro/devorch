# Plan: fix-flow-friction-backlog

<description>
Address the 10 unresolved flow-friction entries captured in `.devorch/flow-issues-inbox/`. Each friction was observed during real `/devorch --full` sessions and documents a concrete ergonomic or correctness gap in a devorch script or in the `/devorch` command itself. This plan batches the fixes by touched file so each task stays within one module; no task spans modules. Three entries already fixed in prior commits (`init-phase-slice-warnings`, `manage-cache-script-missing`, `plan-invariants-numbered-not-named`) were removed from the inbox before this plan was authored.
</description>

<objective>
After this plan:
- `.devorch/flow-issues-inbox/` is empty.
- `setup-worktree.ts`, `merge-worktree.ts`, `list-worktrees.ts` and `commands/devorch.md` each have the behaviors documented in the corresponding inbox entries.
- `check-project --quick` passes at the end of every phase.
- No regression in existing satellite / merge flows (verified by adversarial review).
</objective>

<classification>
Type: refactor+bugfix
Complexity: medium
Risk: medium
</classification>

<decisions>
- Execution model → Full-mode, 4 phases (one phase per touched module), sequential waves (no parallel builders on same file).
- Satellite `path` field semantics (#12) → Unify on `repoPath` everywhere; update both consumer scripts and the /devorch skill doc. Rationale: `merge-worktree.ts` already expects `repoPath`; `phase-summary.ts` ignores `path` altogether. Standardizing on `repoPath` requires no code change to phase-summary and matches what setup-worktree's `--add-secondary` already emits.
- `.env` auto-copy on worktree create (#1) → Copy if present, provide `--no-env` opt-out. Rationale: dotenv is the common case; paranoid users get an explicit escape hatch.
- Untracked-files check on satellite creation (#8) → Abort with actionable error (list the untracked files) rather than interactive prompt. Rationale: interactive prompts inside scripts called by the orchestrator are fragile; the orchestrator can recover and re-prompt the user via AskUserQuestion.
- Identical-content untracked auto-remove (#11) → Auto-remove only after byte-for-byte diff with the committed version in the branch being merged. Log the removal. Rationale: git's overwrite check is pessimistic; byte-identical overwrites are trivially safe.
- Inbox cleanup → Each phase deletes the inbox files it addresses as part of its own commit. No orphan cleanup phase.
</decisions>

<problem-statement>
The `flow-issues-inbox` has grown to 13 entries (now 10 after pre-plan triage). Each represents a real friction observed during `/devorch --full` runs:
- 3 `setup-worktree.ts` gaps (env, untracked-files in satellite, cwd-inside-worktree).
- 3 `merge-worktree.ts` robustness gaps (zero-commit satellite, detached HEAD, identical-content untracked block).
- 1 `list-worktrees.ts` bug (wrong planTitle).
- 3 orchestrator/skill gaps (F5 parallel file overlap, Q2/S5 pre-edit WIP check, satellite path field ambiguity).

Without addressing these, each future full-run continues to pay the manual-recovery cost documented in each entry (some >30min per occurrence).
</problem-statement>

<solution-approach>
Four sequential phases, each targeting one module:

1. **Phase 1 — `commands/devorch.md`**: three surgical doc edits (F5 guard text, Q2/S5 pre-edit check text, F3e/F7 explicit `repoPath`). No script code changes. Low risk.

2. **Phase 2 — `setup-worktree.ts`**: add `.env` auto-copy, add `--no-env` flag, detect cwd inside `.worktrees/` and resolve to real mainRoot, add untracked-file-in-satellite check that aborts with clear JSON error. Keep existing warning-based flow for primary repo uncommitted changes.

3. **Phase 3 — `merge-worktree.ts`**: three additive checks in the existing pipeline: (a) before dry-run, detect byte-identical untracked and auto-remove; (b) in `resolveRepo`, fall back to `git worktree list --porcelain` when `branch --show-current` returns empty (detached HEAD); (c) before `mergeRepo`, detect `0 commits ahead` and skip the merge step while still running `cleanupRepo`.

4. **Phase 4 — `list-worktrees.ts`**: prefer `<worktree-name>.md` when selecting planFile; fall back to alphabetical first. One function (`findPlanFile` local to the file, lines 158-165). Also removes the remaining inbox file.

Each phase ends with its own `check-project --quick` (F3d) and commit. Inter-phase contract: phases are independent — no phase depends on another's output — but sequential dispatch keeps collisions at zero and commits clean.

Alternatives considered and rejected:
- **Single fat task** across all files: violates wave discipline, makes review harder, loses per-module rollback.
- **Parallel phases**: all four phases together in one wave — three of the four files are orthogonal but the skill doc (`commands/devorch.md`) edits would race; not worth the parallelism for ~4 builders.
- **Per-atrito task granularity**: 10 tasks × 10 dispatch cycles is pure overhead; the atritos within each file are internally cohesive (setup-worktree's three fixes all live in the "create worktree" code path; merge-worktree's three all live in the "merge pipeline" code path).
</solution-approach>

<relevant-files>
- `commands/devorch.md` — Phase 1 edits (F5 guard, Q2/S5 pre-edit check, F3e/F7 repoPath).
- `scripts/setup-worktree.ts` — Phase 2 edits (env copy, cwd resolution, satellite untracked check).
- `scripts/merge-worktree.ts` — Phase 3 edits (identical-untracked, detached HEAD, zero-commit satellite).
- `scripts/list-worktrees.ts` — Phase 4 edits (planFile preference).
- `scripts/lib/git-utils.ts` — may gain helper for untracked-file listing (Phase 2 supporting).
- `.devorch/flow-issues-inbox/*.md` — 10 files deleted progressively across phases.
</relevant-files>

<phase1 name="Skill doc fixes">
<goal>Apply three surgical edits to commands/devorch.md covering F5 file-overlap guard, Q2/S5 pre-edit WIP check, and F3e/F7 satellite path semantics.</goal>

<spec>
<behavior name="f5-parallel-builder-overlap-guard">
  <precondition>F5 stage has N findings classified as fix-level with relevant-files extractable per finding.</precondition>
  <postcondition>The /devorch command instructs the orchestrator, before dispatching parallel builders, to union each finding's relevant-files set and sequentialize findings that share any file, matching the same wave-conflict discipline validate-plan.ts enforces at F3c. Findings without file overlap still dispatch in parallel.</postcondition>
</behavior>

<behavior name="q2-s5-pre-edit-wip-check">
  <precondition>Orchestrator is in Q2 (quick mode execute) or S5 (scoped mode execute) and is about to Edit or Write a tracked file in projectRoot.</precondition>
  <postcondition>The command instructs the orchestrator to run `git -C projectRoot status --porcelain <file>` before the first mutation of that file. If the file shows `M`, `A`, `MM`, `AM`, or `UU`, pause with AskUserQuestion offering options: (a) bundle the WIP into this session's commit, (b) stash the WIP and apply on top after, (c) split — commit WIP alone first then proceed. Untracked-only files (`??`) do not trigger the gate.</postcondition>
</behavior>

<behavior name="f3e-f7-satellite-repopath">
  <precondition>Orchestrator has a non-empty `<satellites>` from F2.8 and is about to call `phase-summary.ts --satellites` (F3e) or `merge-worktree.ts --satellites` (F7).</precondition>
  <postcondition>The command explicitly documents that the JSON shape is `[{name, path, status?}, ...]` where `path` is the satellite's `repoPath` (the repo root, NOT the worktreePath inside it). merge-worktree resolves `.worktrees/<name>` internally from `path`. phase-summary ignores `path` (only name+status used). Examples in F3e and F7 show `repoPath` usage explicitly.</postcondition>
</behavior>

<invariant name="language-policy">Only English in code-fenced command snippets and JSON shapes; surrounding Portuguese prose preserved as-is in sections that are already Portuguese.</invariant>
<invariant name="no-box-drawing">Plain markdown only. No ASCII art or decorative box characters anywhere.</invariant>
</spec>

<tasks>
#### 1. Apply three skill edits in commands/devorch.md
- **ID**: devorch-md-skill-fixes
- **Assigned To**: devorch-builder
- **Spec refs**: f5-parallel-builder-overlap-guard, q2-s5-pre-edit-wip-check, f3e-f7-satellite-repopath, language-policy, no-box-drawing
- Edit the F5 section to add a short paragraph before "Classify each finding" instructing the orchestrator to pre-check file-overlap among fix-level findings and sequentialize overlapping ones into separate waves.
- Edit Q2 (line ~98) and S5 (line ~157) to add a sub-step before "Apply the edit" that runs `git -C <projectRoot> status --porcelain <file>` on each about-to-edit tracked file and pauses via AskUserQuestion (bundle/stash/split) on `M|A|MM|AM|UU`.
- Edit F3e (line ~232) and F7 (line ~286) to replace the generic `build JSON as [{name, path}, ...]` wording with an explicit `path = satellite.repoPath` directive, and add a one-line clarification that merge-worktree resolves the worktree path internally.
- Also delete the inbox entries addressed: `2026-04-20-parallel-builders-commit-collision.md`, `2026-04-20-scoped-unaware-of-preexisting-wip.md`, `2026-04-21-satellite-path-field-ambiguous.md`.
</tasks>

<execution>
**Wave 1**: devorch-md-skill-fixes
</execution>

<criteria>
- [ ] F5 section contains the pre-dispatch file-overlap guard instruction.
- [ ] Q2 and S5 sections contain the pre-edit WIP check instruction with `git status --porcelain` and AskUserQuestion branching.
- [ ] F3e and F7 mention `repoPath` explicitly and clarify that merge-worktree resolves worktreePath internally.
- [ ] Three inbox files deleted in the same commit.
- [ ] `check-project --quick` passes (docs-only change; no lint/typecheck impact expected).
</criteria>

<handoff>
No runtime artifact carried to Phase 2 — Phase 2 edits a different file. Phase 2 may validate its correctness against the (now updated) skill doc when needed, but does not consume any symbol from Phase 1.
</handoff>
</phase1>

<phase2 name="setup-worktree resilience">
<goal>Harden setup-worktree.ts with .env propagation, cwd-inside-worktree detection, and satellite untracked-file guard.</goal>

<spec>
<behavior name="env-auto-copy">
  <precondition>`setup-worktree.ts` is invoked in primary mode (not `--add-secondary`), `<mainRoot>/.env` exists, and `<worktreePath>/.env` does not exist.</precondition>
  <postcondition>After worktree creation and before returning JSON, the script copies `<mainRoot>/.env` to `<worktreePath>/.env` (file mode preserved). Output JSON includes `envCopied: true`. If `.env` is absent in mainRoot, the step is a no-op and `envCopied` is absent or `false`. When `--no-env` is passed, the step is skipped regardless and `envCopied: false`.</postcondition>
</behavior>

<behavior name="cwd-inside-worktree-detection">
  <precondition>`process.cwd()` contains `/.worktrees/<anything>` as a path segment.</precondition>
  <postcondition>The script resolves the real mainRoot by walking up from cwd until the parent directory containing `.worktrees/` is found, then uses that path as `cwd` for all subsequent operations (worktreesDir, git -C, etc.). Logs to stderr: `Detected cwd inside .worktrees/; resolved mainRoot = <path>`. When cwd is not inside `.worktrees/`, behavior is unchanged.</postcondition>
</behavior>

<behavior name="satellite-untracked-guard">
  <precondition>`--add-secondary` or `--secondary` is invoked and at least one satellite repo has untracked files (per `git ls-files --others --exclude-standard`) that are not inside a `.worktrees/`, `node_modules/`, or `dist/` path.</precondition>
  <postcondition>Before creating that satellite's worktree, the script emits a structured JSON error: `{ok: false, error: "satellite-untracked", satellite: <name>, repoPath: <path>, untrackedFiles: [...]}` and exits with code 1. No satellite worktrees are created (atomicity). The orchestrator or user must commit / stash / ignore the files and retry.</postcondition>
</behavior>

<invariant name="exit-code-stability">Existing exit codes 0/1/2 preserved. Only structured JSON errors added; never silent failures.</invariant>
<invariant name="backward-compat-noenv">`.env` handling must NOT break existing callers that pass only `--name`. The new flag `--no-env` is opt-in; default behavior is to copy if present.</invariant>
</spec>

<tasks>
#### 1. Harden setup-worktree.ts with three guards
- **ID**: setup-worktree-hardening
- **Assigned To**: devorch-builder
- **Spec refs**: env-auto-copy, cwd-inside-worktree-detection, satellite-untracked-guard, exit-code-stability, backward-compat-noenv
- **Exemplars**: `scripts/setup-worktree.ts` (current structure — copy-uncommitted-devorch-files block lines 292-327 shows the pattern for file copy to worktree)
- Add `--no-env` boolean to `parseArgs` call.
- After the `createSingleWorktree` call in primary mode (around line 290), if `<mainRoot>/.env` exists and `--no-env` was not passed, `cpSync` it to `<worktreePath>/.env`. Track `envCopied` in output JSON.
- Near the top of the file, after `const cwd = process.cwd()` (line 30), detect `/.worktrees/` in cwd and walk up to find the real mainRoot; reassign `cwd` and `worktreesDir` before any git calls. Log to stderr.
- In `createSatellites` (lines 227-257), before each `createSingleWorktree`, collect `git ls-files --others --exclude-standard` in the satellite's repoPath (via a new helper in `lib/git-utils.ts` named `getUntrackedFiles(repoPath: string, excludeGlobs?: string[])` — add the helper there). Filter out `.worktrees/`, `node_modules/`, `dist/`. If non-empty, emit `{ok: false, error: "satellite-untracked", satellite: name, repoPath, untrackedFiles}` and `process.exit(1)` BEFORE creating any satellite worktree (check-then-create pattern).
- Also delete inbox entries: `2026-04-20-env-not-copied-to-worktree.md`, `2026-04-20-satellite-worktree-untracked-files.md`, `2026-04-21-setup-worktree-cwd-resolution.md`.
</tasks>

<execution>
**Wave 1**: setup-worktree-hardening
</execution>

<criteria>
- [ ] `--no-env` flag parseable; default behavior copies `.env` when present.
- [ ] Running setup-worktree from `/home/bruno/dev/devorch/.worktrees/X` resolves mainRoot to `/home/bruno/dev/devorch` (verify by running the script from the worktree directory with `--name other-name --recreate` in a scratch state, or by reading the resolved path from stderr log).
- [ ] Satellite untracked-files guard aborts with structured JSON; no partial satellite creation.
- [ ] `getUntrackedFiles` helper added to `scripts/lib/git-utils.ts` with clear signature.
- [ ] Three inbox files deleted in the same commit.
- [ ] `check-project --quick` passes.
</criteria>

<handoff>
Phase 3 will use the same `.worktrees/` cwd-resolution pattern if it needs to handle the case — no shared helper required, but the pattern is now established. Phase 3 does NOT depend on setup-worktree changes at runtime (no integration tests here).
</handoff>
</phase2>

<phase3 name="merge-worktree edge cases">
<goal>Add three edge-case handlers to merge-worktree.ts: identical-untracked auto-remove, detached HEAD branch resolution, and zero-commit satellite skip.</goal>

<spec>
<behavior name="identical-untracked-auto-remove">
  <precondition>Before `dryRunMerge` runs for a repo, the repo's main working tree has untracked files whose content is byte-identical to the version of the same path inside the branch being merged.</precondition>
  <postcondition>The script computes a byte-for-byte diff per untracked candidate against `git show <branch>:<path>`; when identical, it removes the untracked file from the main working tree and logs `[<name>] Removed identical-content untracked file: <path>`. The dry-run then proceeds without the pessimistic overwrite failure. Non-identical untracked files are left alone (do not remove — orchestrator should surface as error).</postcondition>
</behavior>

<behavior name="detached-head-branch-resolution">
  <precondition>`resolveRepo` is called for the primary with `expectedBranch === null` and `git branch --show-current` in the worktree returns empty (HEAD is detached).</precondition>
  <postcondition>The script falls back to `git worktree list --porcelain` on `repoMainPath`, finds the entry matching the worktreePath, and reads its `branch` field (refs/heads/<name>). If the branch exists and the ref can be resolved to a SHA, re-attach HEAD via `git -C <worktreePath> checkout <branchName>` and proceed with `actualBranch = <branchName>`. If the fallback also fails, emit the current fail() with the added hint line: `HEAD is detached; worktree list --porcelain did not resolve a matching branch.`</postcondition>
</behavior>

<behavior name="zero-commit-satellite-skip">
  <precondition>A repo in `repos[]` has `commitsIntegrated === 0` per `computeStats` (no commits between mainBranch..branch).</precondition>
  <postcondition>Before calling `mergeRepo` for that repo, the script logs `[<name>] 0 commits ahead of <mainBranch>; skipping merge, proceeding to cleanup.` and appends a synthetic merge outcome `{ok: true, sha: null, squash: args.squash, skipped: true}` to `mergeResults`. `cleanupRepo` still runs for the repo. The final JSON `repos[]` entry for a skipped repo has `merged: null`, `commitsIntegrated: 0`, `skipped: true`, `worktreeRemoved: true|false`, `branchDeleted: true|false`. Dry-run pre-flight (when `hasSatellites`) also skips the skipped repo to prevent the false "merge produced no new commit" signal.</postcondition>
</behavior>

<invariant name="atomicity-guard-preserved">The existing atomicity guard (dry-run ALL before merging ANY) stays intact. The only change is that zero-commit repos are excluded from both dry-run and merge steps but still go through cleanup.</invariant>
<invariant name="json-shape-additive">Additions to output JSON (`skipped` field, new log lines) are additive. No existing field removed or renamed.</invariant>
</spec>

<tasks>
#### 1. Handle three merge-worktree edge cases
- **ID**: merge-worktree-edge-cases
- **Assigned To**: devorch-builder
- **Spec refs**: identical-untracked-auto-remove, detached-head-branch-resolution, zero-commit-satellite-skip, atomicity-guard-preserved, json-shape-additive
- **Exemplars**: `scripts/merge-worktree.ts` (current pipeline: resolveRepo → rebaseRepo → computeStats → dryRunMerge → mergeRepo → cleanupRepo)
- Add a helper `removeIdenticalUntracked(repo: RepoTarget): string[]` that lists mainRoot untracked files via `git ls-files --others --exclude-standard`, and for each candidate, diffs against `git show <branch>:<path>`; byte-equal → `rm` + log. Call this helper as the first step inside `dryRunMerge` (before `ensureOnMainBranch`) AND as the first step inside `mergeRepo` (belt-and-suspenders, since dry-run is optional for single-repo).
- Modify `resolveRepo` (around line 196-199) to detect empty `branchCheck.stdout` AND `expectedBranch === null`, then invoke `git worktree list --porcelain` on `repoMainPath`, parse the matching entry, and re-attach HEAD via `checkout`. Only apply this fallback to primary (expectedBranch === null); satellites with expected branch should still fail if the branch mismatches.
- Add a `commitsIntegrated === 0` short-circuit near the top of the "Merge sequentially" loop (around line 571). Skip the merge step but still collect the repo into cleanup. Also filter zero-commit repos out of the dry-run loop (around line 542) so they don't generate false "no new commit" errors.
- Also delete inbox entries: `2026-04-20-merge-worktree-aborts-on-zero-commit-satellite.md`, `2026-04-20-worktree-head-detached-after-phase-summary.md`, `2026-04-21-merge-blocks-on-identical-untracked-files.md`.
</tasks>

<execution>
**Wave 1**: merge-worktree-edge-cases
</execution>

<criteria>
- [ ] `removeIdenticalUntracked` helper present and invoked before dryRunMerge + mergeRepo.
- [ ] Detached-HEAD fallback uses `git worktree list --porcelain` and re-attaches via checkout.
- [ ] Zero-commit-ahead repos are skipped from both dry-run and merge, but still cleaned up.
- [ ] Three inbox files deleted in the same commit.
- [ ] `check-project --quick` passes.
</criteria>

<handoff>
Phase 4 does not depend on Phase 3 output.
</handoff>
</phase3>

<phase4 name="list-worktrees plan detection">
<goal>Fix list-worktrees.ts planFile selection to prefer self-named `<worktree>.md`, falling back to alphabetical.</goal>

<spec>
<behavior name="planfile-prefer-self-named">
  <precondition>A worktree at `.worktrees/<name>/` has `.devorch/plans/` with one or more `.md` files (excluding the `archive/` subdir).</precondition>
  <postcondition>`list-worktrees.ts` selects `<name>.md` as the planFile when it exists. When it does not exist, the script logs a warning to stderr (`Warning: <name>/.devorch/plans/ has no self-named plan; using <first-alphabetical>.md`) and falls back to the first `.md` alphabetically — matching the previous behavior. When multiple non-archived `.md` files exist AND `<name>.md` is present, the others are ignored silently (no warning, since this is a known copy-on-create artifact).</postcondition>
</behavior>

<invariant name="json-shape-unchanged">Output JSON shape must remain `{worktrees: [{name, path, branch, planTitle, status, lastPhase, totalPhases, valid, satellites}], count, mainBranch}`. Only the value of `planTitle` improves; no new fields added.</invariant>
</spec>

<tasks>
#### 1. Prefer self-named plan in list-worktrees.ts
- **ID**: list-worktrees-plan-preference
- **Assigned To**: devorch-builder
- **Spec refs**: planfile-prefer-self-named, json-shape-unchanged
- Replace the planFile selection in `list-worktrees.ts` (lines 158-165) with preference logic: `entries.find((f) => f === \`${name}.md\`) || entries.find((f) => f.endsWith(".md") && f !== "archive")`. Log the fallback warning to stderr when the self-named plan is absent but alphabetical fallback is used.
- Also delete inbox entry: `2026-04-20-list-worktrees-reports-wrong-plantitle.md`.
</tasks>

<execution>
**Wave 1**: list-worktrees-plan-preference
</execution>

<criteria>
- [ ] `<name>.md` takes precedence over alphabetical first.
- [ ] Warning logged on fallback.
- [ ] Inbox file deleted.
- [ ] `check-project --quick` passes.
- [ ] `.devorch/flow-issues-inbox/` is empty after this phase's commit.
</criteria>
</phase4>
