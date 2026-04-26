# Plan: flow-friction-residual-fixes

<description>
Resolve 6 unresolved flow-friction items in `.devorch/flow-issues-inbox/` via 4 surgical fixes across `setup-worktree.ts`, `merge-worktree.ts`, `validate-plan.ts`, `init-phase.ts`, and `commands/devorch.md`. Each fix is mechanical and self-contained; sequential waves avoid the same-worktree race that one of the items itself documents (and that this plan also fixes).
</description>

<objective>
After this plan: (1) `setup-worktree.ts` accepts `--allow-devorch-dirt` and has expanded default exclude list; (2) `merge-worktree.ts` distinguishes dirty-worktree from rebase-conflict; (3) `validate-plan.ts` blocks waves with 2+ same-Repo tasks; (4) `init-phase.ts` runs `tldr-analyze` per repo and emits compact stdout + per-task disk detail; (5) `commands/devorch.md` Step 9c reads disk detail; (6) `flow-issues-inbox/` is empty.
</objective>

<classification>
Type: refactor+bugfix
Complexity: medium
Risk: low
</classification>

<decisions>
- Sequential waves over parallel because the parallel-builder shared-worktree race (one of the frictions being fixed here) would manifest with multiple builders on the primary repo otherwise.
- 4 small fixes split into 2 phases: Phase 1 = A+B+C (3 sequential waves on distinct files), Phase 2 = D-init then D-orchestrator (2 sequential waves; orchestrator consumes new init-phase shape).
- D combined (D.1 satellite TLDR + D.2 output split) into a single init-phase task because both refactor the output assembly path; splitting into separate tasks would cause file collision.
- `--legacy-json` flag added to `init-phase.ts` as backwards-compat for D.2; default is the new compact stdout + disk detail.
- Hard error (not warning) for same-Repo wave violation in `validate-plan.ts`; matches the spirit of the existing file-overlap check.
- Per-task markdown files written under `.devorch/cache/phase-init-<N>/<task-id>.md` to leverage the cache split conceito (gitignored, ephemeral).
</decisions>

<problem-statement>
6 inbox items remain after recent cleanup waves:
1. `init-phase` JSON output ~51KB blocks shell parsing (`2026-04-21-init-phase-json-output-too-large.md`).
2. `setup-worktree` satellite-untracked exclude list too narrow (`2026-04-21-setup-worktree-satellite-untracked-atomic-abort.md`).
3. Parallel builders on same satellite worktree see each other's WIP (`2026-04-22-parallel-builders-shared-worktree-race.md`).
4. `tldr-analyze` runs only on `projectRoot`, leaving `codeStructureByTask` empty for satellite tasks (`2026-04-22-satellite-code-structure-empty-on-init-phase.md`).
5. `merge-worktree` rebase-conflict report has empty `conflictFiles` when actually dirty-worktree (`2026-04-23-merge-worktree-rebase-conflict-empty-files.md`).
6. `setup-worktree` no opt-in for `.devorch/**` dirt (`2026-04-23-setup-worktree-satellite-untracked-no-opt-in.md`).
</problem-statement>

<solution-approach>
Two phases.

**Phase 1** — three trivial mechanical fixes on distinct files, sequential waves to avoid the same-worktree race:
- Wave 1: `setup-worktree.ts` — expand exclude list + add `--allow-devorch-dirt`.
- Wave 2: `merge-worktree.ts` — pre-flight `git status --porcelain` in `rebaseRepo()`; emit `dirty-worktree` reason discriminated from `rebase-conflict`.
- Wave 3: `validate-plan.ts` — group tasks by `Repo` per wave; hard error on 2+ same-Repo.

**Phase 2** — two-wave fix coordinating init-phase + orchestrator:
- Wave 1: `init-phase.ts` — group `tldr-analyze` by task.repo (run per repo via `Promise.allSettled`); split output into compact stdout JSON + per-task markdown files under `.devorch/cache/phase-init-<N>/`. Add `--legacy-json` for backwards-compat.
- Wave 2: `commands/devorch.md` Step 9c — read `<detailPath>/<task-id>.md` for builder prompt assembly instead of reading per-task JSON fields.

Each phase ends with `check-project --quick`. Each task removes its own inbox files in the same commit.

Alternatives considered and rejected:
- **All 4 fixes parallel in a single phase**: would trigger the very race we are fixing (multiple builders on the same primary worktree).
- **5 phases (one per fix)**: ceremony tax for trivial fixes; 2 phases is enough granularity.
- **D split into D.1 and D.2 as separate tasks**: both refactor the output assembly in `init-phase.ts`; splitting causes file collision.
- **D-orchestrator merged into D-init task**: file overlap with a different module (`commands/devorch.md`); splitting keeps each task scoped to one module.
</solution-approach>

<relevant-files>
- `scripts/setup-worktree.ts` — Fix A
- `scripts/merge-worktree.ts` — Fix B
- `scripts/validate-plan.ts` — Fix C
- `scripts/init-phase.ts` — Fix D-init (D.1 + D.2)
- `commands/devorch.md` — Fix D-orchestrator (Step 9c)
- `.devorch/flow-issues-inbox/*.md` — 6 files removed across the 4 builder commits
- `scripts/lib/git-utils.ts` — provides `getUntrackedFiles` consumed by Fix A
- `scripts/lib/plan-parser.ts` — provides `extractSecondaryRepos` consumed by Fix D
- `scripts/lib/slice-builder.ts` — provides task `repo` field used by Fix D path-grouping
</relevant-files>

<global-invariants>
- Each task removes its corresponding inbox file(s) in the same commit that lands the fix.
- All scripts continue to emit JSON to stdout for orchestrator parsing.
- `init-phase.ts` writes per-task markdown files unconditionally (default mode and `--legacy-json` mode); only the stdout shape differs between modes.
- Plain markdown only in user-facing output; no box-drawing.
- No new dependencies added.
</global-invariants>

<phase1 name="Trivial fixes (A, B, C)">
<goal>Apply three surgical script fixes for setup-worktree (frictions 2 + 6), merge-worktree (friction 5), validate-plan (friction 3). Each task removes its inbox files in the same commit. Sequential waves avoid the parallel-builder race that friction 3 itself documents.</goal>

<spec>
<behavior name="setup-worktree-expanded-exclude-list">
  <precondition>`setup-worktree.ts:291` calls `getUntrackedFiles(repoPath, [".worktrees/", "node_modules/", "dist/"])` for the satellite-untracked guard.</precondition>
  <postcondition>The hardcoded exclude list is expanded to also include `.devorch/cache/`, `.claude/worktrees/`, `scripts/out/`. Order does not matter; first-segment prefix matching applies. The wider list catches devorch-internal and build-output paths that satellite repos commonly do not gitignore.</postcondition>
</behavior>

<behavior name="setup-worktree-allow-devorch-dirt-flag">
  <precondition>`setup-worktree.ts` `parseArgs` definition lives at lines 15-22; the satellite-untracked guard at lines 287-302 currently has no opt-in for `.devorch/**` files.</precondition>
  <postcondition>`parseArgs` def gains entry `{name: "allow-devorch-dirt", type: "boolean", required: false}`. When the flag is set, the satellite-untracked guard additionally filters out any path under `.devorch/` from the untracked list before the count check. When the flag triggers a filter, the script logs to stderr one line per filtered file in the form `[<satellite-name>] ignored .devorch/* via --allow-devorch-dirt: <path>`. The existing exit-on-untracked behavior is unchanged for non-`.devorch/` paths.</postcondition>
</behavior>

<behavior name="setup-worktree-error-suggests-flag">
  <precondition>The satellite-untracked guard fires (post-filter `untrackedFiles.length > 0`) and `--allow-devorch-dirt` is NOT set.</precondition>
  <postcondition>The error JSON gains a `hint` field with value `"Pass --allow-devorch-dirt to ignore .devorch/* files (devorch's own outputs)."` only when at least one path in `untrackedFiles` begins with `.devorch/`. If no file is under `.devorch/`, the `hint` field is omitted (only show the hint when it would actually help).</postcondition>
</behavior>

<behavior name="merge-worktree-dirty-pre-flight">
  <precondition>`rebaseRepo()` at `merge-worktree.ts:275-320` is about to call `git rebase`. The worktree may have tracked dirty files (modified, staged, etc.) that would cause `git rebase` to refuse without producing actual conflict markers, leaving the existing `collectConflictFiles()` to return `[]`.</precondition>
  <postcondition>Before invoking `git rebase`, `rebaseRepo()` runs `git status --porcelain` on the worktree path. It splits stdout by newline, filters lines that DO NOT begin with `??` (untracked-only is allowed; tracked dirty is not), trims the leading 3-char status code from each remaining line. If the resulting list is non-empty, return `{ok: false, reason: "dirty-worktree", dirtyFiles: <list>, target: rebaseTarget}` without invoking `git rebase`. The existing rebase-conflict path stays intact for actual conflicts (when rebase runs and produces `UU/AA/DU/UD` entries).</postcondition>
</behavior>

<behavior name="merge-worktree-failure-report-discriminates-reason">
  <precondition>The caller at `merge-worktree.ts:551-564` maps `rebaseRepo()`'s `{ok: false, ...}` result into the `fail()` invocation. Today it always emits `reason: "rebase-conflict"` and `conflictFiles`.</precondition>
  <postcondition>The caller branches on `res.reason`: when `"dirty-worktree"`, emit `failedRepos[].reason: "dirty-worktree"` and `failedRepos[].dirtyFiles: <list>`, with top-level error message `Dirty worktree in <role> "<name>" against <target>`. When `"rebase-conflict"` (existing path), emit `failedRepos[].reason: "rebase-conflict"` and `failedRepos[].conflictFiles: <list>`, with the existing top-level message `Rebase conflict in <role> "<name>" against <target>`.</postcondition>
</behavior>

<behavior name="validate-plan-same-repo-wave-block">
  <precondition>`validate-plan.ts` wave validation at lines 354-427 collects task IDs and their declared file refs per wave; tasks are parsed at lines 491-510 with a `Repo:` field defaulting to `"primary"`.</precondition>
  <postcondition>For each wave, additionally group tasks by their `repo` value (using `"primary"` when unspecified). If any group has 2+ tasks, append to the `errors[]` array a string of the form `Wave <N> in phase <P> has 2+ tasks targeting Repo "<name>": [<task-id-list>]. Builders sharing a worktree see each other's WIP during typecheck/lint — split into separate waves.` This is a hard error (added to `errors[]`), not a warning.</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Setup-worktree expanded exclude + opt-in flag
- **ID**: setup-worktree-allow-devorch-dirt
- **Assigned To**: devorch-builder
- **Spec refs**: setup-worktree-expanded-exclude-list, setup-worktree-allow-devorch-dirt-flag, setup-worktree-error-suggests-flag
- **Non-goals**: do not change behavior for primary-repo uncommitted-changes warning; do not change error JSON shape outside adding the optional `hint` field
- **Exemplars**: `scripts/setup-worktree.ts:15-22` (parseArgs def), `scripts/setup-worktree.ts:287-302` (satellite-untracked guard), `scripts/lib/git-utils.ts` (`getUntrackedFiles` signature)
- Edit `scripts/setup-worktree.ts`: add `--allow-devorch-dirt` to parseArgs (line 15-22 region); expand the exclude list at line 291; after `getUntrackedFiles(...)` returns, if `args["allow-devorch-dirt"]` is true, additionally filter out paths starting with `.devorch/` and stderr-log each filtered path; in the abort path, append `hint` to the error JSON when any untracked file is under `.devorch/`.
- Remove `.devorch/flow-issues-inbox/2026-04-21-setup-worktree-satellite-untracked-atomic-abort.md` and `.devorch/flow-issues-inbox/2026-04-23-setup-worktree-satellite-untracked-no-opt-in.md` in the same commit.

#### 2. Merge-worktree dirty pre-flight
- **ID**: merge-worktree-dirty-preflight
- **Assigned To**: devorch-builder
- **Spec refs**: merge-worktree-dirty-pre-flight, merge-worktree-failure-report-discriminates-reason
- **Non-goals**: do not modify the conflict-detection logic; do not change the success path; do not change other phases of the merge pipeline (check, stats, dry-run, merge, cleanup)
- **Exemplars**: `scripts/merge-worktree.ts:275-320` (rebaseRepo function), `scripts/merge-worktree.ts:551-564` (caller / fail invocation)
- Edit `scripts/merge-worktree.ts`: in `rebaseRepo()`, before `git rebase` (around line 312), run `git status --porcelain` and check tracked-only dirty (filter out `??` lines); if non-empty, return `{ok: false, reason: "dirty-worktree", dirtyFiles, target}`. Update the caller (around line 553) to branch on `res.reason` and emit appropriate failure shape per spec.
- The `rebaseRepo()` return type today is `{ok: true} | {ok: false; conflictFiles: string[]; target: string}`. Extend it to `{ok: true} | {ok: false; reason: "rebase-conflict"; conflictFiles: string[]; target: string} | {ok: false; reason: "dirty-worktree"; dirtyFiles: string[]; target: string}`. Existing return at line 316 (after rebase fails) gains `reason: "rebase-conflict"` explicitly.
- Remove `.devorch/flow-issues-inbox/2026-04-23-merge-worktree-rebase-conflict-empty-files.md` in the same commit.

#### 3. Validate-plan same-repo wave block
- **ID**: validate-plan-same-repo-block
- **Assigned To**: devorch-builder
- **Spec refs**: validate-plan-same-repo-wave-block
- **Non-goals**: do not change the existing file-overlap check; do not soften to warning; do not change task or spec parsing logic
- **Exemplars**: `scripts/validate-plan.ts:354-427` (wave validation loop), `scripts/validate-plan.ts:491-510` (task parsing including `Repo:` field)
- Edit `scripts/validate-plan.ts`: in the per-wave loop (around line 399), additionally group the wave's tasks by `task.repo || "primary"`; for any group with 2+ entries, push the documented error string to `errors[]`.
- Remove `.devorch/flow-issues-inbox/2026-04-22-parallel-builders-shared-worktree-race.md` in the same commit.
</tasks>

<execution>
**Wave 1**: setup-worktree-allow-devorch-dirt
**Wave 2**: merge-worktree-dirty-preflight
**Wave 3**: validate-plan-same-repo-block
</execution>

<criteria>
- [ ] `setup-worktree.ts` accepts `--allow-devorch-dirt` and expanded exclude list applies
- [ ] `setup-worktree.ts` error includes `hint` only when at least one untracked is under `.devorch/`
- [ ] `merge-worktree.ts` emits `reason: "dirty-worktree"` with `dirtyFiles` for dirty case; existing conflict case unchanged
- [ ] `validate-plan.ts` emits hard error when wave has 2+ same-Repo tasks
- [ ] 4 inbox files removed (frictions 2, 3, 5, 6)
- [ ] `bun scripts/check-project.ts <projectRoot> --quick` passes after Phase 1
</criteria>

<handoff>
Phase 2 modifies `init-phase.ts` and `commands/devorch.md`. No file overlap with Phase 1. The new `validate-plan` rule from Phase 1 means future plans cannot have 2+ same-Repo tasks per wave; this plan itself does not violate (every wave has exactly 1 task).
</handoff>
</phase1>

<phase2 name="Init-phase satellite TLDR + output split (D.1 + D.2)">
<goal>`init-phase.ts` runs `tldr-analyze` per repo (covering satellite tasks); JSON output is split into compact stdout summary + per-task markdown detail files. `commands/devorch.md` Step 9c consumes the new disk detail.</goal>

<spec>
<interface name="init-phase-stdout-summary-shape">
  <input>n/a — output shape change</input>
  <output>By default (no `--legacy-json` flag), `init-phase.ts` stdout JSON has shape `{ok: true, phaseNumber, phaseName, totalPhases, planTitle, satellites, waves, taskIds, sliceWarnings, detailPath}`. `detailPath` is the worktree-relative path `.devorch/cache/phase-init-<phaseNumber>/`. The legacy per-task fields (`gotchasByTask`, `codeStructureByTask`, `specsByTask`, `exemplarsByTask`, `nonGoalsByTask`) and the legacy `gotchas` concatenated field are NOT in stdout JSON in default mode. With `--legacy-json` flag, stdout includes all the legacy fields AND `detailPath` for orchestrators in transition.</output>
</interface>

<behavior name="init-phase-per-task-detail-files">
  <precondition>`init-phase.ts` has assembled `gotchasByTask`, `codeStructureByTask`, `specsByTask`, `exemplarsByTask`, `nonGoalsByTask` Records keyed by task ID (existing logic at lines 379-470 area).</precondition>
  <postcondition>For each task ID, `init-phase.ts` writes a markdown file at `<projectRoot>/.devorch/cache/phase-init-<phaseNumber>/<task-id>.md` with sections in this order (each with `## ` header; sections with empty content are omitted entirely): `## Spec Contracts` (from `specsByTask`), `## Code Structure` (from `codeStructureByTask`), `## Gotchas` (from `gotchasByTask`), `## Exemplars` (from `exemplarsByTask`, joined with newlines), `## Non-goals` (from `nonGoalsByTask`). Parent directory created with `mkdir` recursive. Existing files overwritten. Files always written, regardless of mode (default or `--legacy-json`).</postcondition>
</behavior>

<behavior name="init-phase-per-repo-tldr">
  <precondition>`init-phase.ts` has `phaseTsFiles: string[]` (extracted from phase content at line 250) and `secondaryRepos: SecondaryRepo[]` (parsed from plan at line 124); each task has a `repo` field defaulting to `"primary"` (set in `slice-builder.ts:89`). Satellite worktree paths are already resolved at lines 139-143 into `satellites: SatelliteInfo[]`.</precondition>
  <postcondition>`init-phase.ts` groups `phaseTsFiles` by inferred repo: for each file path, find the task that references it (via existing `extractFileRefs` or path matching against task content) and use that task's `repo`. Files not matched to any task or matched to `"primary"` tasks belong to the primary repo. For each non-empty repo group, run `bun tldr-analyze.ts --files <csv> --root <repoRoot>` in parallel via `Promise.allSettled`. Primary's `repoRoot` is `projectRoot`; each satellite's `repoRoot` is its `worktreePath` from the satellites list. Merge all per-repo results into a single `tldrByFile` Record keyed by absolute path (resolve each relative path against its repo root before keying). Downstream `codeStructureByTask` filtering at line 412 already uses `path.includes(ref) || path.endsWith(ref)`; absolute keys still match relative refs by suffix.</postcondition>
</behavior>

<behavior name="init-phase-legacy-json-flag">
  <precondition>`init-phase.ts` `parseArgs` def gains a `--legacy-json` boolean flag.</precondition>
  <postcondition>When `--legacy-json` is set, stdout JSON includes all the per-task fields (`gotchasByTask`, `codeStructureByTask`, `specsByTask`, `exemplarsByTask`, `nonGoalsByTask`) AND the legacy concatenated `gotchas` field, in addition to the new compact summary fields and `detailPath`. The disk markdown files are written either way.</postcondition>
</behavior>

<behavior name="devorch-md-step-9c-reads-detail-files">
  <precondition>`init-phase.ts` now emits `detailPath` and writes per-task markdown files. `commands/devorch.md` Step 9c at lines 193-196 currently reads `gotchasByTask[task-id]`, `codeStructureByTask[task-id]`, etc. inline from JSON.</precondition>
  <postcondition>Step 9c is rewritten to: (1) for each task being dispatched, read `<detailPath>/<task-id>.md` from disk via the Read tool; (2) inject the markdown content under a single `## Phase Context` section in the builder prompt, replacing the previous five separate sections (Gotchas / Code Structure / Exemplars / Spec Contracts / Non-goals). The orchestrator's `## Explore Findings` section remains separate and is appended after `## Phase Context` (since findings are orchestrator-curated and not in the disk file). Builder prompt order: Working Directory → Plan Objective + Solution Approach + Decisions → Full task details → `## Phase Context` (from disk) → `## Explore Findings` (orchestrator-curated). The line at `commands/devorch.md:182` referencing `contentFile` is updated to clarify it now applies only to `--legacy-json` mode (or removed if no longer needed).</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Init-phase per-repo TLDR + output split
- **ID**: init-phase-multirepo-and-split
- **Assigned To**: devorch-builder
- **Spec refs**: init-phase-stdout-summary-shape, init-phase-per-task-detail-files, init-phase-per-repo-tldr, init-phase-legacy-json-flag
- **Non-goals**: do not change `gotchasByTask`/`specsByTask`/etc. assembly logic; do not change the slice gate calculation or thresholds; do not move `project-map.md` or `phase-context.md` out of `cache/`; do not change `extractTsFiles` extraction logic
- **Exemplars**: `scripts/init-phase.ts:124-143` (satellite resolution + worktreePath), `scripts/init-phase.ts:250-310` (current single-repo TLDR launch), `scripts/init-phase.ts:540-611` (output construction including overflow path), `scripts/lib/plan-parser.ts:184-197` (`extractSecondaryRepos`), `scripts/lib/slice-builder.ts:71-115` (`parseTasks`, sets `task.repo`)
- Edit `scripts/init-phase.ts`:
  - Add `--legacy-json` to `parseArgs`.
  - Refactor the `tldr-analyze` call to group `phaseTsFiles` by their inferred owning task's repo, then launch one `tldr-analyze.ts` subprocess per distinct repo with that repo's worktree path as `--root`. Collect results via `Promise.allSettled`; merge into `tldrByFile` keyed by absolute path. Resolve each subprocess's per-file path against its repo root before adding to the merged map. (Note: existing `formatTldrAnalysis()` returns relative paths in the keys; resolve them when merging.)
  - After per-task fields are assembled (after line ~470), write per-task markdown files to `<projectRoot>/.devorch/cache/phase-init-<phaseNumber>/<task-id>.md` with the spec'd sections (omit empty ones).
  - Build new compact stdout shape with the documented fields. When `--legacy-json` is set, additionally include the existing per-task fields and legacy `gotchas` field.
- Remove `.devorch/flow-issues-inbox/2026-04-22-satellite-code-structure-empty-on-init-phase.md` and `.devorch/flow-issues-inbox/2026-04-21-init-phase-json-output-too-large.md` in the same commit.

#### 2. Commands/devorch.md Step 9c reads disk detail
- **ID**: devorch-md-step-9c-disk-detail
- **Assigned To**: devorch-builder
- **Spec refs**: devorch-md-step-9c-reads-detail-files
- **Non-goals**: do not change Step 9a (init-phase invocation), do not change Step 9b (slice gate), do not change Step 9d (per-phase check), do not change Step 9e (phase summary), do not change other Steps (1-8, 10-15)
- **Exemplars**: `commands/devorch.md:175-215` (Step 9 surrounding context), `commands/devorch.md:193-196` (current builder prompt assembly with five sections), `commands/devorch.md:182` (current `contentFile` overflow reference)
- Edit `commands/devorch.md`: rewrite the Step 9c builder-prompt-assembly paragraph. New flow:
  - For each task in the wave, the orchestrator reads `<detailPath>/<task-id>.md` from disk (Read tool) to get per-task phase context.
  - Builder prompt structure becomes: Working Directory → Plan Objective + Solution Approach + Decisions → Full task details → `## Phase Context` (the markdown read from disk) → `## Explore Findings` (orchestrator-curated, separate).
  - Mention that the disk file already groups Spec Contracts / Code Structure / Gotchas / Exemplars / Non-goals under `## ` headers; orchestrator does not re-parse these.
  - The line at `commands/devorch.md:182` referencing `contentFile` is updated to note it now applies only to `--legacy-json` mode (or removed if redundant after the rewrite).
</tasks>

<execution>
**Wave 1**: init-phase-multirepo-and-split
**Wave 2**: devorch-md-step-9c-disk-detail
</execution>

<criteria>
- [ ] `init-phase.ts` emits compact stdout JSON by default; `--legacy-json` flag preserves old shape with all per-task fields
- [ ] `init-phase.ts` writes per-task markdown files at `<projectRoot>/.devorch/cache/phase-init-<N>/<task-id>.md` (regardless of mode)
- [ ] `init-phase.ts` runs `tldr-analyze` per repo (primary + each satellite); satellite tasks now have non-empty `## Code Structure` in their detail file
- [ ] `commands/devorch.md` Step 9c reads detail file from disk and injects as `## Phase Context`
- [ ] 2 inbox files removed (frictions 1, 4)
- [ ] `flow-issues-inbox/` is empty
- [ ] `bun scripts/check-project.ts <projectRoot>` (full) passes
</criteria>
</phase2>
