# Plan: Pipeline fixes — sparse checkout, merge guard, self-build reinstall, wave parsing

<description>
Fix 4 bugs in the devorch pipeline: sparse-checkout fallback leaving worktrees in broken state,
untracked files blocking merge, self-build not reinstalling after merge, and wave type parsing
defaulting to sequential instead of parallel.
</description>

<objective>
All 4 pipeline bugs are fixed: sparse-checkout failure cleanly falls back to full checkout,
untracked file conflicts are resolved before merge, self-build triggers bun run install after merge,
and wave type defaults to parallel unless explicitly marked sequential.
</objective>

<classification>
Type: fix
Complexity: simple
Risk: medium
</classification>

<decisions>
Sparse checkout: remove ROOT_CONFIG_FILES entirely (redundant in cone mode) AND add sparse-checkout disable on failure paths → belt and suspenders
Self-build reinstall: run bun run install BEFORE cleanup steps (archive-plan etc.) so cleanup uses updated scripts
Merge tasks 2+3 into single task since both modify build.md and talk.md merge sections
Execution: inline build, single wave parallel
</decisions>

<relevant-files>
- `scripts/setup-worktree.ts` — sparse-checkout logic with broken fallback (lines 65-107, 195-199)
- `commands/build.md` — merge flow section starting at line 315
- `commands/talk.md` — merge flow section 10i starting at line 470
- `scripts/init-phase.ts` — parseWaves function with incorrect type default (lines 305-308)

<new-files>
</new-files>
</relevant-files>

<phase1 name="Pipeline fixes">
<goal>Fix all 4 pipeline bugs in a single parallel wave</goal>

<spec>
<behavior name="sparse-checkout-failure-cleanup">
  <precondition>applySparseCheckout() called; sparse-checkout init --cone succeeds; sparse-checkout set fails (exit != 0 or exception)</precondition>
  <postcondition>git sparse-checkout disable executed on wtPath before returning null; worktree behaves as full checkout (core.sparseCheckout=false)</postcondition>
</behavior>
<behavior name="remove-root-config-files">
  <precondition>ROOT_CONFIG_FILES array exists at line 66 in applySparseCheckout</precondition>
  <postcondition>ROOT_CONFIG_FILES removed from cone path list; only BASE_SPARSE_PATHS + user sparsePaths passed to sparse-checkout set</postcondition>
</behavior>
<behavior name="detect-and-track-conflicting-untracked-files">
  <precondition>merge about to start; branch may have committed files that exist as untracked in mainRoot</precondition>
  <postcondition>before dry-run merge: conflicting untracked files detected via git diff --name-only + git ls-files --others; if intersection non-empty: git add + commit "chore: track files before devorch merge"</postcondition>
</behavior>
<error-contract name="no-untracked-conflicts">
  <case trigger="intersection of branch files and untracked files is empty" handling="skip detection, proceed to dry-run as before" />
</error-contract>
<behavior name="reinstall-after-self-build">
  <precondition>merge succeeded; changed files include prefixes scripts/, agents/, commands/, or hooks/</precondition>
  <postcondition>bun run install executed in mainRoot BEFORE cleanup steps; installed scripts in ~/.claude/ match merged versions</postcondition>
</behavior>
<error-contract name="not-self-build">
  <case trigger="no changed files match scripts/|agents/|commands/|hooks/ prefixes" handling="skip install, proceed to cleanup" />
</error-contract>
<behavior name="wave-type-parallel-default">
  <precondition>parseWaves() processes execution block</precondition>
  <postcondition>waves default to type parallel; only annotation === "sequential" sets type to sequential; "(after wave N)" does NOT affect type</postcondition>
</behavior>
<invariant>"(after wave N)" is a dependency hint only — never changes intra-wave execution mode</invariant>
</spec>

<tasks>
#### 1. Fix sparse-checkout fallback
- **ID**: sparse-checkout-cleanup
- **Assigned To**: builder-1
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: sparse-checkout-failure-cleanup, remove-root-config-files
- In `scripts/setup-worktree.ts`, function `applySparseCheckout()`:
- Remove `ROOT_CONFIG_FILES` constant (line 66) and remove it from the paths array built at lines 80-90. Keep only `BASE_SPARSE_PATHS` and user-provided `sparsePaths`
- At lines 96-99 (set failure path): before `return null`, add `Bun.spawnSync(["git", "-C", wtPath, "sparse-checkout", "disable"])` to cleanly disable sparse-checkout
- At lines 103-106 (catch path): same — add `sparse-checkout disable` before `return null`
- This ensures the worktree is a true full checkout when sparse-checkout fails

#### 2. Add merge guards — untracked files + self-build reinstall
- **ID**: merge-flow-fixes
- **Assigned To**: builder-2
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: detect-and-track-conflicting-untracked-files, no-untracked-conflicts, reinstall-after-self-build, not-self-build
- In `commands/build.md` merge section (around line 385, before dry-run merge):
  - Add step: run `git -C <mainRoot> diff --name-only <branch>` to list files the branch brings
  - Cross with `git -C <mainRoot> ls-files --others --exclude-standard` (untracked files)
  - If intersection non-empty: `git -C <mainRoot> add <conflicting-files>` + `git -C <mainRoot> commit -m "chore: track files before devorch merge"`
- In `commands/build.md` after successful merge, BEFORE cleanup steps:
  - Add step: run `git -C <mainRoot> diff --name-only <originalBranch>..HEAD` and check for prefixes `scripts/`, `agents/`, `commands/`, `hooks/`
  - If match found: run `bun run install` in mainRoot, log "devorch scripts updated — running install"
- Apply identical changes to `commands/talk.md` merge section (step 10i, around line 482 for untracked guard, around line 504 for reinstall)

#### 3. Fix wave type default to parallel
- **ID**: wave-type-default
- **Assigned To**: builder-3
- **Model**: sonnet
- **Effort**: low
- **Spec refs**: wave-type-parallel-default
- In `scripts/init-phase.ts`, function `parseWaves()`, lines 305-308:
- Remove `|| annotation.startsWith("after wave")` from the conditional
- Result: only `annotation === "sequential"` sets type to "sequential"
- This is a single-line change

</tasks>

<execution>
**Wave 1** (parallel): sparse-checkout-cleanup, merge-flow-fixes, wave-type-default
</execution>

<criteria>
- [ ] Sparse-checkout failure results in clean full checkout (no residual sparse-checkout config)
- [ ] ROOT_CONFIG_FILES no longer passed to cone mode
- [ ] Untracked files that conflict with merge branch are auto-tracked before merge
- [ ] Self-build triggers bun run install after merge when scripts/agents/commands/hooks changed
- [ ] Wave type defaults to parallel; only explicit (sequential) annotation changes it
</criteria>
</phase1>
