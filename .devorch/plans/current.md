# Plan: Always-Worktree Architecture + Smart Check Feedback

<description>
Two architectural changes to devorch: (1) Make worktrees the default execution model — every plan runs in its own worktree with its own branch, explore-cache stays in the main repo (read-only for worktrees), and after build the user merges or keeps parked. (2) Smart check-implementation feedback loop — instead of just listing `/devorch:quick` suggestions, check-implementation now classifies issues into trivial (fix inline automatically), ambiguous (AskUserQuestion then fix), and complex (deliver ready-to-paste `/devorch:make-plan` prompt). New `/devorch:worktrees` command for listing, merging, and deleting worktrees.
</description>

<objective>
Every `/devorch:make-plan` creates a worktree — no plans live in main's `current.md`. Build auto-detects the target worktree. Check-implementation fixes trivial issues inline, asks for clarification on ambiguous ones, and suggests make-plan for complex ones. A new `/devorch:worktrees` command provides full worktree lifecycle management.
</objective>

<classification>
Type: enhancement
Complexity: complex
Risk: medium
</classification>

<decisions>
- Check feedback model → Three-tier: trivial = fix inline automatically, ambiguous = AskUserQuestion then fix, complex = deliver ready-to-paste /devorch:make-plan prompt with detailed description
- Inline fix execution → Execute directly in build context (check-implementation runs inline in build.md), no Task agent needed
- Explore-cache location → Only in main repo (read-only for worktrees). Invalidation only happens on main when worktree merges.
- current.md in main → Eliminated. Plans always live in worktrees. Legacy current.md auto-archived on first run.
- Build without --plan → Auto-detect: 1 worktree = use it, 2+ = list and ask, 0 = error
- /devorch:worktrees → Full command: list + merge + delete
</decisions>

<problem-statement>
Two gaps in devorch's workflow: (1) After build, check-implementation finds issues but only outputs paste-ready `/devorch:quick` commands — the user must manually copy/paste each one, even for trivial fixes like leftover TODOs. When the check has doubts about what to do, it has no way to ask. (2) Worktrees are only used when there's already an in-progress plan, but they should be the default execution model — isolated branches with merge-at-end give better safety and parallelism for every plan, not just parallel ones.
</problem-statement>

<solution-approach>
**Always-worktree**: Remove all non-worktree code paths from make-plan.md. Every plan creates a worktree via setup-worktree.ts. Build.md auto-detects the target worktree when --plan is omitted. Explore-cache stays in main repo — scripts get new flags (--cache-root for init-phase.ts, --root for manage-cache.ts) to read/write cache from main while executing in a worktree. New list-worktrees.ts script provides data for the worktrees command.

**Smart check feedback**: Rewrite check-implementation.md Step 6. After producing the report, classify each issue as trivial/ambiguous/complex. Trivial → edit files and commit inline (re-run check-project.ts after). Ambiguous → AskUserQuestion with concrete options, then fix based on answer. Complex → generate detailed /devorch:make-plan prompt. Re-verify after inline fixes.

**Alternatives considered:**
- Cache per worktree (copy on create): rejected — leads to stale/divergent caches across worktrees. Shared read-only cache is simpler.
- Task agent for inline fixes: rejected — check already runs inline in build context, has all tools available, adding a Task adds overhead without benefit.
- Separate merge script: rejected — merge logic is straightforward (4 git commands), keeping it inline in build.md and worktrees.md is cleaner.
</solution-approach>

<relevant-files>
- `scripts/init-phase.ts` — add --cache-root flag for reading explore-cache from main repo
- `scripts/manage-cache.ts` — add --root flag for operating on cache at a different root
- `scripts/setup-worktree.ts` — stop copying explore-cache.md to worktree
- `commands/make-plan.md` — remove non-worktree paths, always create worktree
- `commands/build.md` — auto-detect worktree, pass mainRoot to phase agents
- `templates/build-phase.md` — use mainRoot for all cache operations
- `commands/check-implementation.md` — three-tier feedback loop with inline execution

<new-files>
- `scripts/list-worktrees.ts` — lists all worktrees with plan name, branch, build status
- `commands/worktrees.md` — list/merge/delete worktrees command
</new-files>
</relevant-files>

<phase1 name="Script Infrastructure">
<goal>Add cache-root awareness to init-phase.ts and manage-cache.ts, create list-worktrees.ts, and stop setup-worktree.ts from copying explore-cache.</goal>

<tasks>
#### 1. Add --cache-root to init-phase.ts
- **ID**: add-cache-root-init
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Add optional `--cache-root <path>` flag to parseArgs in `scripts/init-phase.ts`
- When `--cache-root` is provided: read explore-cache from `<cache-root>/.devorch/explore-cache.md` instead of from the plan file's directory
- When `--cache-root` is NOT provided: keep existing behavior (read from plan's directory)
- Update the JSDoc header to document the new flag
- The filtering logic (matching cache sections by phase file paths) stays unchanged — only the source path of the cache file changes

#### 2. Add --root to manage-cache.ts
- **ID**: add-root-manage-cache
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Add optional `--root <path>` flag to parseArgs in `scripts/manage-cache.ts`
- When `--root` is provided: resolve cache path as `<root>/.devorch/explore-cache.md` and run git commands with `cwd: <root>`
- When `--root` is NOT provided: keep existing behavior (resolve relative to `process.cwd()`)
- Update the JSDoc header to document the new flag
- The `getChangedFiles()` function should also use the root as cwd for `git diff` when --root is provided

#### 3. Create list-worktrees.ts
- **ID**: create-list-worktrees
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Create `scripts/list-worktrees.ts` following existing script conventions (JSDoc header, parseArgs, JSON output, Bun APIs)
- **Usage**: `bun list-worktrees.ts` (no required args)
- **Logic**:
  - Check if `.worktrees/` directory exists. If not, output empty result.
  - Read directory entries in `.worktrees/` (filter for directories only)
  - For each worktree directory:
    - Read `.worktrees/<name>/.devorch/plans/current.md` → extract plan title from `# Plan: <title>` heading. If file missing, title = "(no plan)"
    - Read `.worktrees/<name>/.devorch/state.md` → extract `Last completed phase: N` and `Status:` line. If missing, status = "not started", lastPhase = 0
    - Count total phases by counting `<phaseN` tags in plan file (if readable)
    - Get branch name: `git -C .worktrees/<name> branch --show-current` via Bun.spawnSync
    - Validate worktree is live: check it appears in `git worktree list` output
  - Sort by name alphabetically
- **Output JSON**:
  ```json
  {
    "worktrees": [
      {
        "name": "feature-a",
        "path": ".worktrees/feature-a",
        "branch": "devorch/feature-a",
        "planTitle": "Add Auth System",
        "status": "ready for phase 3",
        "lastPhase": 2,
        "totalPhases": 4,
        "valid": true
      }
    ],
    "count": 1
  }
  ```
- **Error handling**: `.worktrees/` missing → `{"worktrees": [], "count": 0}`. Individual worktree read failure → include entry with available fields, set missing fields to defaults.

#### 4. Stop copying explore-cache in setup-worktree.ts
- **ID**: exclude-cache-setup
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- In `scripts/setup-worktree.ts`, modify the file copy loop (where uncommitted `.devorch/` files are copied to the worktree)
- Add a filter: skip any file path that matches `explore-cache.md` (i.e., `.devorch/explore-cache.md`)
- The explore-cache stays exclusively in the main repo — worktrees read it from there via init-phase.ts --cache-root
- All other .devorch/ files (CONVENTIONS.md, state.md, plans/, etc.) continue to be copied as before

#### 5. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify init-phase.ts accepts --cache-root flag: read the file, check parseArgs handles the flag, and the explore-cache reading path uses cache-root when provided
- Verify manage-cache.ts accepts --root flag: read the file, check parseArgs handles the flag, cachePath and git commands use the root when provided
- Verify list-worktrees.ts exists with correct structure: scans .worktrees/, reads plan title + state + branch for each, outputs JSON array
- Verify setup-worktree.ts filters out explore-cache.md from the copy loop
- Run `bun scripts/list-worktrees.ts` — should output `{"worktrees":[],"count":0}` (no worktrees exist)
- Run `bun scripts/init-phase.ts 2>&1 || true` — should show usage including --cache-root
- Run `bun scripts/manage-cache.ts 2>&1 || true` — should show usage including --root
</tasks>

<execution>
**Wave 1** (parallel): add-cache-root-init, add-root-manage-cache, create-list-worktrees, exclude-cache-setup
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] `init-phase.ts` accepts `--cache-root <path>` and reads explore-cache from `<cache-root>/.devorch/explore-cache.md` when provided
- [ ] `init-phase.ts` default behavior unchanged when `--cache-root` is not provided
- [ ] `manage-cache.ts` accepts `--root <path>` and resolves cache path + git cwd to the specified root
- [ ] `manage-cache.ts` default behavior unchanged when `--root` is not provided
- [ ] `list-worktrees.ts` exists, scans `.worktrees/`, outputs JSON with name/path/branch/planTitle/status/lastPhase/totalPhases/valid
- [ ] `list-worktrees.ts` outputs `{"worktrees":[],"count":0}` when no worktrees exist
- [ ] `setup-worktree.ts` no longer copies `explore-cache.md` to the worktree
- [ ] All scripts follow conventions: JSDoc, named fs imports, no npm deps, JSON stdout, exit 1 for bad args
</criteria>

<validation>
- `bun scripts/list-worktrees.ts` — outputs valid JSON with empty worktrees array
- `bun scripts/init-phase.ts 2>&1 | head -3` — shows usage including --cache-root
- `bun scripts/manage-cache.ts 2>&1 | head -3` — shows usage including --root
- `grep "cache-root" scripts/init-phase.ts` — flag exists
- `grep "root" scripts/manage-cache.ts` — flag exists
- `grep "explore-cache" scripts/setup-worktree.ts` — filter exists
</validation>

<handoff>
Four script changes ready: init-phase.ts reads cache from configurable root, manage-cache.ts operates on configurable root, list-worktrees.ts provides worktree inventory, setup-worktree.ts no longer copies cache to worktrees. Next phase updates all command files to use always-worktree architecture with these new script capabilities.
</handoff>
</phase1>

<phase2 name="Always-Worktree Commands">
<goal>Update make-plan.md, build.md, and build-phase.md to use always-worktree architecture — plans always live in worktrees, cache always reads from main.</goal>

<tasks>
#### 1. Update make-plan.md for always-worktree
- **ID**: update-make-plan
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Modify `commands/make-plan.md` with these changes:

- **Step 1 (Load context)**: Replace the entire `If .devorch/plans/current.md exists:` block with migration logic:
  - If `.devorch/plans/current.md` exists in main: archive it silently via `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan .devorch/plans/current.md`. Report: "Migrated legacy plan to archive."
  - Remove the "Archive old plan" vs "Run in parallel worktree" AskUserQuestion — it no longer applies.
  - Remove the `worktreeMode` variable — it's always true now.

- **Step 8 (Create plan)**: Remove the "Otherwise" (non-worktree) branch entirely. The only path is:
  1. Derive a kebab-case name from the plan's descriptive name
  2. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <kebab-name>`. Parse JSON output to get `worktreePath`.
  3. Write the plan to `<worktreePath>/.devorch/plans/current.md`
  4. Copy `.devorch/CONVENTIONS.md` to `<worktreePath>/.devorch/CONVENTIONS.md` (if exists)
  5. Do NOT copy explore-cache.md (it stays in main, worktrees read from main via --cache-root)
  6. Set `planPath = <worktreePath>/.devorch/plans/current.md` for subsequent steps.

- **Step 10 (Reset state)**: Remove the "Otherwise" branch. Always: delete `<worktreePath>/.devorch/state.md` and `<worktreePath>/.devorch/state-history.md` if they exist.

- **Step 11 (Auto-commit)**: Remove the "Otherwise" (non-worktree) branch. Always:
  - Commit in worktree branch: `git -C <worktreePath> add .devorch/plans/current.md .devorch/CONVENTIONS.md` + commit `"chore(devorch): plan — <plan name>"`
  - Commit in main: stage `.devorch/explore-cache.md`, `.devorch/CONVENTIONS.md` (if updated) + commit `"chore(devorch): add worktree for <plan name>"`

- **Step 12 (Report)**: Remove the non-worktree branch from the report. Always show:
  - If `--auto`: same behavior but always append `--plan <name>` to the build prompt
  - If NOT `--auto`: always show `Plan saved to worktree: <worktreePath> (branch: <branch>)\n/clear\n/devorch:build --plan <name>`

#### 2. Update build.md for auto-detect
- **ID**: update-build
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Modify `commands/build.md` with these changes:

- **Step 0 (Resolve plan path)**: Rewrite the resolution logic:
  1. If `--plan <value>` provided: same as current (bare name → worktree, full path → as-is)
  2. If `--plan` NOT provided (NEW LOGIC):
     - Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON output
     - If `count == 0`: report error "No active worktrees. Run `/devorch:make-plan` first." and stop.
     - If `count == 1`: auto-detect. Set `planPath = .worktrees/<name>/.devorch/plans/current.md`, `projectRoot = .worktrees/<name>`. Report: "Auto-detected worktree: <name> (<planTitle>)"
     - If `count > 1`: use `AskUserQuestion` to present the worktrees as options (each option shows name + plan title + status). Set planPath and projectRoot based on the user's choice.
  3. Remove the old default `planPath = .devorch/plans/current.md` — this path no longer exists.

- **Set `isWorktree = true` always** (since plans always live in worktrees). Remove the conditional `isWorktree = projectRoot != "."`.

- **Add `mainRoot`**: Set `mainRoot` to the repo root (where `.worktrees/` lives). This is the cwd of the build.md execution context. Pass `mainRoot` as context to phase agents.

- **Step 2 (Phase loop)**: When launching phase agents, append to the prompt: `\n\nMain repo root for cache: <mainRoot>` so build-phase.md knows where to find/write the explore cache.

- **Step 3 (check-implementation)**: Add note that check-implementation has access to `<planPath>`, `<projectRoot>`, and `<mainRoot>`.

- **Step 5 (Merge)**: Remove the `Skip this step if isWorktree is false` guard — this step always runs now.

#### 3. Update build-phase.md for main-root cache
- **ID**: update-build-phase
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Modify `templates/build-phase.md` with these changes:

- **Parse mainRoot**: At the start, extract `mainRoot` from the prompt context (the text appended by build.md: "Main repo root for cache: <path>"). If not found, default to cwd (backward compatibility).

- **Step 1 (Init phase)**: Change init-phase.ts call to pass `--cache-root <mainRoot>`:
  - Old: `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N`
  - New: `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N --cache-root <mainRoot>`

- **Step 8 (Cache operations)**:
  - When appending new Explore agent summaries: write to `<mainRoot>/.devorch/explore-cache.md` (not `<projectRoot>/.devorch/explore-cache.md`)
  - Change manage-cache.ts call to use `--root <mainRoot>`:
    - Old: `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000`
    - New: `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000 --root <mainRoot>`

#### 4. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verify make-plan.md:
  - No longer references `worktreeMode` variable or conditional
  - No "Archive old plan" vs "Run in parallel worktree" AskUserQuestion
  - Legacy current.md is auto-archived on detection
  - Step 8 always creates worktree (no "Otherwise" branch)
  - Step 12 always shows worktree path
  - explore-cache.md is NOT copied to worktree in step 8
- Verify build.md:
  - Step 0 runs list-worktrees.ts when no --plan provided
  - Auto-detect with 1 worktree, AskUserQuestion with 2+, error with 0
  - No default `planPath = .devorch/plans/current.md`
  - `mainRoot` variable is set and passed to phase agents
  - Step 5 has no `isWorktree` guard (always runs)
- Verify build-phase.md:
  - Parses mainRoot from prompt context
  - init-phase.ts call includes `--cache-root <mainRoot>`
  - manage-cache.ts call includes `--root <mainRoot>`
  - Explore summary appends target `<mainRoot>/.devorch/explore-cache.md`
- `grep -c "worktreeMode" commands/make-plan.md` — should be 0
- `grep "current.md" commands/build.md` — should NOT appear as a default path (may appear in worktree resolution)
- `grep "cache-root" templates/build-phase.md` — present
- `grep "mainRoot" commands/build.md` — present
</tasks>

<execution>
**Wave 1** (parallel): update-make-plan, update-build, update-build-phase
**Wave 2** (validation): validate-phase-2
</execution>

<criteria>
- [ ] make-plan.md always creates a worktree — no conditional worktreeMode, no non-worktree path
- [ ] make-plan.md auto-archives legacy current.md in main repo
- [ ] make-plan.md does NOT copy explore-cache.md to worktree
- [ ] build.md auto-detects worktree when --plan is omitted (list-worktrees.ts → 0=error, 1=auto, 2+=ask)
- [ ] build.md no longer defaults to `.devorch/plans/current.md`
- [ ] build.md sets and passes `mainRoot` to phase agents
- [ ] build.md Step 5 (merge) always runs (no isWorktree guard)
- [ ] build-phase.md passes `--cache-root <mainRoot>` to init-phase.ts
- [ ] build-phase.md passes `--root <mainRoot>` to manage-cache.ts
- [ ] build-phase.md appends explore summaries to `<mainRoot>/.devorch/explore-cache.md`
</criteria>

<validation>
- `grep -c "worktreeMode" commands/make-plan.md` — returns 0
- `grep "list-worktrees" commands/build.md` — present
- `grep "cache-root" templates/build-phase.md` — present
- `grep "mainRoot" templates/build-phase.md` — present
- `grep "mainRoot" commands/build.md` — present
- `grep "explore-cache" commands/make-plan.md` — should NOT appear in step 8 copy list
</validation>

<handoff>
All command files now use always-worktree architecture. make-plan always creates worktrees, build auto-detects the target, build-phase reads/writes cache from main repo root. Next phase adds the smart check-implementation feedback loop and the new /devorch:worktrees management command.
</handoff>
</phase2>

<phase3 name="Smart Check Feedback + Worktrees Command">
<goal>Rewrite check-implementation.md with three-tier feedback (auto-fix trivial, ask ambiguous, suggest make-plan for complex) and create the /devorch:worktrees management command.</goal>

<tasks>
#### 1. Rewrite check-implementation.md feedback loop
- **ID**: rewrite-check-feedback
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Modify `commands/check-implementation.md` — replace Step 6 (Follow-up) entirely with this three-tier system:

**Replace Step 6 with: Smart Dispatch**

After producing the report (Step 5), if the verdict is FAIL or has warnings, classify each issue found (from cross-phase integration, automated checks, file artifacts, adversarial review):

**Issue Classification** (evaluate each issue against these rules, in order):

1. **Trivial** — fix is self-evident, single-file, no ambiguity:
   - Leftover `TODO`, `FIXME`, `HACK`, `XXX` comments from builders
   - Unused imports or orphan exports
   - Missing semicolons, trailing whitespace, formatting issues
   - Obvious typos in strings or variable names
   - Empty catch blocks or stub implementations that should have been filled
   - A file that should exist but is missing from a simple copy/rename oversight

2. **Ambiguous** — multiple valid interpretations, needs user input:
   - Behavior change that might be intentional or accidental
   - Naming that could follow multiple conventions
   - Code that works but differs from the pattern in CONVENTIONS.md — unclear if deliberate
   - A test that fails but the expected behavior is debatable
   - A handoff contract that was partially honored — unclear which part matters

3. **Complex** — requires architectural thought, multiple files, or new design:
   - Missing feature that was in the plan but not implemented
   - Structural issue affecting 4+ files
   - Performance problem requiring algorithmic changes
   - Security vulnerability requiring design-level fix
   - Integration issue between multiple modules

**Dispatch Logic** (execute in this order):

**Step 6a — Fix trivial issues inline:**
- For each trivial issue: edit the file directly using the Edit tool. Keep fixes minimal — only change what's needed.
- After all trivial fixes: stage and commit changed files with message `fix(check): <concise description of fixes>`
- Re-run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` to verify no regressions
- Report: "Fixed N trivial issues inline: [one-line list]"

**Step 6b — Ask about ambiguous issues:**
- For each ambiguous issue (or group of related ones): use `AskUserQuestion` with 2-4 concrete options describing the possible interpretations
- Include file:line evidence and the specific ambiguity in the question
- Based on the user's answer:
  - If the answer makes the fix trivial → fix inline (same as 6a: edit, commit, check-project)
  - If the answer reveals complexity → add to the complex list (Step 6c)
- Report each resolution

**Step 6c — Suggest make-plan for complex issues:**
- Group related complex issues into a single coherent description
- Generate a ready-to-paste command with full context:
  ```
  /devorch:make-plan <detailed description including: what's wrong, which files are affected, what the expected outcome should be>
  ```
- Do NOT attempt to fix complex issues inline — they need proper planning
- Report: "These issues require planning. Suggested command above."

**Step 6d — Re-verify (after any inline fixes):**
- If any fixes were made in steps 6a or 6b:
  - Re-run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` — verify lint + typecheck pass
  - Re-run `bun $CLAUDE_HOME/devorch-scripts/verify-build.ts --plan <planPath>` — verify artifacts
  - If both pass and no complex issues remain: update verdict to **PASS**
  - If both pass but complex issues exist: update verdict to **PASS with N complex issues noted**
  - If re-verification fails: report the new failures (do not loop — one round of fixes only)

- Also update the check-implementation.md header note to mention that it now resolves trivial issues automatically and asks for clarification on ambiguous ones
- In Step 1 (Load plan data), parameterize the plan path: replace hardcoded `.devorch/plans/current.md` with `<planPath>` (passed from build.md context as the variable set in Step 0)
- In Step 2 (Determine changed files), ensure git commands use the correct working directory when in a worktree (use `git -C <projectRoot>` pattern)

#### 2. Create worktrees.md command
- **ID**: create-worktrees-cmd
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Create `commands/worktrees.md` with YAML frontmatter:
  ```yaml
  ---
  description: List, merge, or delete devorch worktrees
  model: opus
  ---
  ```

- **Workflow**:

  **Step 1 — List worktrees:**
  - Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON output
  - If count == 0: report "No active worktrees." and stop.
  - Display a formatted list:
    ```
    ## Active Worktrees

    1. **feature-a** (branch: devorch/feature-a)
       Plan: Add Auth System
       Status: Phase 2/4 complete — ready for phase 3

    2. **api-refactor** (branch: devorch/api-refactor)
       Plan: Refactor API Layer
       Status: Completed (all 3 phases)
    ```

  **Step 2 — Ask action:**
  - Use `AskUserQuestion`:
    - **"Merge a worktree"** — merge a completed worktree into main
    - **"Delete a worktree"** — remove an abandoned worktree (branch + directory)
    - **"Done"** — exit

  **Step 3a — Merge flow (if "Merge"):**
  - If only 1 worktree: use it. If multiple: `AskUserQuestion` to select which one.
  - Show what will be merged: `git log --oneline <mainBranch>..<worktreeBranch>`
  - Confirm via `AskUserQuestion`: "Merge N commits from <branch> into <mainBranch>?"
  - If confirmed:
    ```bash
    git checkout <mainBranch>
    git merge <worktreeBranch>
    ```
  - If merge succeeds:
    ```bash
    git worktree remove <worktreePath>
    git branch -d <worktreeBranch>
    ```
    Report: "Merged and cleaned up <name>."
  - If merge has conflicts: report conflicts, instruct manual resolution. Do NOT force.

  **Step 3b — Delete flow (if "Delete"):**
  - If only 1 worktree: use it. If multiple: `AskUserQuestion` to select which one.
  - Confirm via `AskUserQuestion`: "Delete worktree <name>? This will remove the branch and all unmerged changes."
  - If confirmed:
    ```bash
    git worktree remove <worktreePath> --force
    git branch -D <worktreeBranch>
    ```
    Report: "Deleted worktree <name> and branch <branch>."

- **Rules**:
  - Do not narrate actions. Execute directly.
  - Never force-merge or auto-resolve conflicts.
  - Deletion is destructive (branch -D) — always confirm first.

#### 3. Validate Phase
- **ID**: validate-phase-3
- **Assigned To**: validator
- Verify check-implementation.md:
  - Step 6 has three-tier classification: trivial (fix inline), ambiguous (AskUserQuestion), complex (suggest make-plan)
  - Trivial fixes: uses Edit tool, commits with `fix(check):` prefix, re-runs check-project.ts
  - Ambiguous issues: uses AskUserQuestion with 2-4 options, file:line evidence included
  - Complex issues: generates ready-to-paste `/devorch:make-plan <detailed description>` command
  - Re-verification step (6d) runs after any inline fixes
  - Step 1 uses `<planPath>` variable (not hardcoded current.md)
  - Step 2 uses `git -C <projectRoot>` for worktree compatibility
- Verify worktrees.md:
  - YAML frontmatter with description and model: opus
  - Step 1 calls list-worktrees.ts and formats output
  - Step 2 offers Merge/Delete/Done via AskUserQuestion
  - Merge flow: shows git log preview, confirms, runs merge sequence (checkout → merge → worktree remove → branch -d)
  - Delete flow: confirms, runs force removal (worktree remove --force → branch -D)
  - Handles merge conflicts (report, don't force)
- `grep "AskUserQuestion" commands/check-implementation.md` — present (for ambiguous issues)
- `grep "make-plan" commands/check-implementation.md` — present (for complex issues)
- `grep "Edit" commands/check-implementation.md` — present (for trivial inline fixes)
- `grep "list-worktrees" commands/worktrees.md` — present
- `grep "AskUserQuestion" commands/worktrees.md` — present
- `test -f commands/worktrees.md` — exists
</tasks>

<execution>
**Wave 1** (parallel): rewrite-check-feedback, create-worktrees-cmd
**Wave 2** (validation): validate-phase-3
</execution>

<criteria>
- [ ] check-implementation.md Step 6 classifies issues as trivial/ambiguous/complex with clear rules for each category
- [ ] Trivial issues are fixed inline: Edit tool + commit with `fix(check):` prefix + re-run check-project.ts
- [ ] Ambiguous issues use AskUserQuestion with 2-4 concrete options and file:line evidence
- [ ] Complex issues generate ready-to-paste `/devorch:make-plan <detailed description>` command
- [ ] Re-verification (Step 6d) runs after inline fixes and can upgrade verdict to PASS
- [ ] check-implementation.md uses `<planPath>` variable, not hardcoded `current.md`
- [ ] check-implementation.md uses `git -C <projectRoot>` for worktree compatibility
- [ ] worktrees.md exists with proper YAML frontmatter (description + model: opus)
- [ ] worktrees.md lists worktrees via list-worktrees.ts with formatted display
- [ ] worktrees.md supports merge flow (git log preview + confirm + merge + cleanup)
- [ ] worktrees.md supports delete flow (confirm + force remove + branch -D)
- [ ] worktrees.md handles merge conflicts gracefully (report, don't force)
</criteria>

<validation>
- `grep "AskUserQuestion" commands/check-implementation.md` — present
- `grep "make-plan" commands/check-implementation.md` — present
- `grep "fix(check)" commands/check-implementation.md` — present (inline fix commit format)
- `grep "planPath" commands/check-implementation.md` — present (parameterized, not hardcoded)
- `grep "projectRoot" commands/check-implementation.md` — present (worktree-aware git)
- `test -f commands/worktrees.md` — exists
- `grep "list-worktrees" commands/worktrees.md` — present
- `grep "merge" commands/worktrees.md` — present
- `grep "branch -D" commands/worktrees.md` — present (delete flow)
</validation>
</phase3>
