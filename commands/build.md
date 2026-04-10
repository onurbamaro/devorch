---
description: Executes all remaining phases of the current devorch plan
argument-hint: [--plan <name>] [--no-tests]
model: opus
---

Execute all remaining phases of the plan automatically, then verify the full implementation.

**Continues from last checkpoint.** Picks up from where the last session left off via `state.md`.

**Input**: `$ARGUMENTS` may contain:
- `--plan <name>` to specify which plan to build. The value can be:
  - A **worktree name** (e.g., `--plan feature-b`) → resolves to `.worktrees/feature-b/.devorch/plans/<name>.md` (where `<name>` is the plan filename; falls back to `current.md` for worktrees created before named plans were introduced)
  - A **full path** (contains `/` or ends in `.md`) → used as-is
  - Omitted → auto-detects from active worktrees
- `--no-tests` (optional boolean flag) → skip tests in the post-review check (3c). When set, the post-review `check-project.ts` receives `--no-test` and the report shows tests as skipped. Parse this flag early alongside `--plan` and store as `noTests = true/false`.

## Workflow

### 0. Resolve plan path

Parse `$ARGUMENTS` for `--plan <value>` and `--no-tests` (boolean, defaults to false).

**Resolution logic:**
1. If `--plan <value>` provided:
   - If value contains `/` or ends in `.md` → treat as full path. Derive `projectRoot` by stripping `/.devorch/plans/<filename>` from the path.
   - Otherwise → treat as worktree name. Set `planPath` by scanning `.worktrees/<value>/.devorch/plans/` for the first `.md` file (excluding `archive/`). If found, use that file; if not found, fall back to `current.md` (backward compat for worktrees created before named plans). Set `projectRoot = .worktrees/<value>`.
2. If `--plan` NOT provided:
   - Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON output.
   - If `count == 0`: report error "No active worktrees. Run `/devorch:talk` first." and stop.
   - If `count == 1`: auto-detect. Scan `.worktrees/<name>/.devorch/plans/` for the first `.md` file (excluding `archive/`); use it as `planPath`. Fall back to `current.md` if no named plan file is found (backward compat). Set `projectRoot = .worktrees/<name>`. Report: "Auto-detected worktree: `<name>` (<planTitle>)"
   - If `count > 1`: use `AskUserQuestion` to present the worktrees as options (each option shows name + plan title + status). Set `planPath` and `projectRoot` based on the user's choice.

Verify the plan file exists. If not, report error and stop.

Set `mainRoot` to the current working directory (the main repo root where `.worktrees/` lives). Plans always live in worktrees, so `isWorktree` is always true.

**Derive `cacheName`** for per-plan cache isolation:
1. If `planPath` contains `.worktrees/<name>/`, extract `<name>` as `cacheName`.
2. Else if `planPath` matches `.devorch/plans/<filename>.md`, use `<filename>` (without `.md` extension) as `cacheName`.
3. Fallback: derive from the plan title by converting to kebab-case (lowercase, spaces to hyphens, strip non-alphanumeric except hyphens).

Store `cacheName` for use in subsequent steps.

All `state.md` references in subsequent steps use `<projectRoot>/.devorch/`. All scripts receive `--plan <planPath>`.

All `git` and `bun` commands in phase agents must run with `cwd` set to `<projectRoot>`.

### 1. Determine scope

- Read the plan title from `<planPath>` (first `# Plan: <name>` heading)
- Read `<projectRoot>/.devorch/state.md` (if exists):
  - Check `Plan:` field matches the current plan title. If mismatch → stale state from a previous plan → start from phase 1.
  - If match → read `Last completed phase: K` → start from phase K+1
  - If no state file → start from phase 1
- Count phase tags (`<phaseN`) in the plan → total phases
- If all phases already complete, report "All N phases already complete" and stop
- Report: "Executing phases X through Y (Z total)"

### 2. Phase loop

**Effort guidance**: Coordinate efficiently. Focus on dispatching tasks and monitoring completion. Avoid deep analysis — that's the builders' job.

For each remaining phase N (sequentially):

#### 2a. Init phase

Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N --cache-root <mainRoot> --cache-name <cacheName>`

Parse JSON output. If `contentFile` field is present, read that file for full phase context. Otherwise use the `content` field directly. This provides: plan objective, decisions, solution approach, phase content, previous handoff, conventions, current state, filtered explore-cache, structured waves and tasks, `specsByTask` (spec contracts extracted from the plan's `<spec>` section, filtered per task by **Spec refs**), `codeStructureByTask` (TLDR structural analysis of TS/TSX files, filtered per task by file refs), and `exploreQueries` (directed explore queries extracted from `<explore-queries>` tag).

#### 2b. Explore

Check the explore cache (included in init-phase output) for areas relevant to this phase's tasks. If the explore-cache contains sections that cover ALL files in `<relevant-files>` for this phase, do NOT launch Explore agents — the cache already provides sufficient context. Only launch Explore agents (use the **Task tool call** with `subagent_type="Explore"`) for areas with partial or missing coverage in cache. Append new summaries to explore-cache.

If init-phase output includes `exploreQueries` (non-empty array), launch directed Explore agents using each query's text as the agent prompt. Each query becomes a focused Explore agent prompt (via Task tool call with `subagent_type="Explore"`). Append results to `explore-cache-<cacheName>.md` with headers matching query subjects. Directed queries are launched in parallel alongside any gap-coverage Explore agents above.

#### 2c. Deploy builders

For each wave from init-phase output, use `TaskCreate` with wave dependencies via `addBlockedBy`. Deploy builders using the **Task tool call** (never Bash/CLI) with `subagent_type="devorch-builder"` as **foreground parallel** calls following the wave structure.

- For `"parallel"` and `"sequential"` type waves: launch all taskIds as parallel Task calls **in a single message** (do NOT use `run_in_background`). The Task calls block until all builders in the wave return — no polling needed.

Each builder prompt includes:
- Plan's **Objective** (from init-phase output), **Solution Approach** (if present), **Decisions** (if present)
- Full task details inline from the `tasks` map (builders skip TaskGet)
- Convention sections from `conventionsByTask[taskId]` — pre-filtered by init-phase.ts based on file extensions in the task
- Code structure from `codeStructureByTask[taskId]` — labeled as "## Code Structure" in the builder prompt. Only include if non-empty. Contains TLDR structural analysis (exports, imports, functions, types) of TS/TSX files relevant to the task. Place AFTER conventions and BEFORE cache sections.
- Spec contracts from `specsByTask[taskId]` — labeled as "## Spec Contracts" in the builder prompt. Pre-filtered by init-phase.ts based on **Spec refs** in the task
- Cache sections from `cacheByTask[taskId]` — pre-filtered by init-phase.ts based on file refs in the task
- **Effort guidance**: "Execute focused implementation. You have a clear spec — prioritize writing correct code over extensive exploration. If you encounter unexpected complexity, use Explore agents rather than reasoning through unknowns."
- **Spec verification instruction**: "Verify your implementation satisfies all spec contracts before committing. Check: function signatures match `<interface>` specs, error handling matches `<error-contract>` cases, pre/postconditions from `<behavior>` specs are honored."
- `commit with type(scope): description`
- `CRITICAL: call TaskUpdate with status "completed" as your very last action`

**Multi-repo tasks**: When init-phase output includes a `satellites` array (non-empty), check each task's `repo` field:
- If `repo` == `"primary"` (or absent): builder uses `<projectRoot>` as working directory (default behavior).
- If `repo` != `"primary"`: find the matching satellite in the `satellites` array by name. Add the following to the builder prompt:
  - `Working directory: <satellite.worktreePath>`
  - `All file operations and git commands must use this directory as root`
  - `Use git -C <satellite.worktreePath> for all git commands`

After all builders in a wave return, verify via `TaskList` that every task is marked completed.

**On builder failure** (task not marked completed after Task call returned, or no matching commit in `git log`):

Track retries **per task ID** (not per wave). Each task has an independent retry counter starting at 0, max 3 retries.

For each retry (up to 3):
1. **Extract error context** from the failed builder's Task result output: capture the **last 50 lines** of output as the error message.
2. **Extract git diff** of changes made by the failed builder: run `git -C <projectRoot> diff HEAD~1` if the builder made any commits (check `git log --oneline -1` for a commit matching the task). If no commits were made, note "No commits from failed attempt."
3. **Re-launch the builder** with the original task context unchanged, plus an additional `## Previous Failure Context` section appended to the prompt containing:
   - `Retry attempt: N of 3`
   - `Error from previous attempt (last 50 lines):` followed by the captured error output
   - `Git diff from failed attempt:` followed by the diff (or "No commits from failed attempt")
   - `Instruction: Analyze the error above. Fix the root cause — do not repeat the same approach if it failed.`
4. Increment the retry counter for this task ID.

**After 3 retries exhausted**: Stop the entire phase. Report structured failure to the user:
```
## Build Failure: <task title>

Task ID: <taskId>
Phase: <N>
Retries exhausted: 3/3

### Error Timeline
Attempt 1: <last 50 lines summary>
Attempt 2: <last 50 lines summary>
Attempt 3: <last 50 lines summary>

### Last Git Diff
<diff from final attempt or "No commits">

### Suggestion
Review the task spec and error pattern. Consider running `/devorch:talk` to re-plan this task with a different approach.
```

Do not continue to the next wave or phase after retry exhaustion. The phase is considered failed.

#### 2d. Validate phase code

**Single-phase plans**: If `totalPhases == 1`, skip per-phase check entirely — the final check in step 3c covers everything. Proceed directly to 2e.

**Multi-phase plans** (`totalPhases > 1`): Run the following via Bash with `run_in_background=true`:

```
bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick
```

Collect results after it completes. The `--quick` flag runs only build and typecheck (lint and test are skipped). Evaluate:
- If build or typecheck fail: fix ALL errors regardless of origin. **Effort guidance for fix loop**: When fixing errors, reason deeply about root cause. Don't just patch symptoms — understand why the error occurred and fix the underlying issue. If unable to fix after one retry, report the errors and block the phase — do not proceed.
- If everything passes: proceed.

**Satellite validation** (when init-phase output includes non-empty `satellites` array): After validating the primary repo, determine which satellites had tasks in this phase by scanning the `tasks` map for entries where `repo` field != `"primary"`. Collect the unique repo names and match them to the `satellites` array by name.

For each satellite that had tasks in this phase, run:
```
bun $CLAUDE_HOME/devorch-scripts/check-project.ts <satellite.worktreePath> --quick
```

If any satellite build/typecheck fail: fix ALL errors regardless of origin. If unable to fix after one retry, report the errors and block the phase.

**Check-project overlap with next phase**: After dispatching builders and they return, start `check-project.ts --quick` in background (`run_in_background=true`) AND start `init-phase.ts` for the next phase in parallel. If check-project fails, stop before dispatching next phase builders. If check passes and next phase init is ready, proceed immediately — no waiting.

#### 2e. Phase summary and commit

Generate commit message and update state in one call:

- Run `bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan <planPath> --phase N --status "ready for phase $((N+1))" --summary "<concise phase summary>"`
- Use the `message` field from the JSON output as the git commit message for all repos.
- The script also writes `state.md` automatically — no separate state update step needed.

**Primary repo**: Run `git -C <projectRoot> status --porcelain`. If output has changes, commit with the generated message.

**Satellite repos** (when init-phase output includes non-empty `satellites` array): For each satellite in the `satellites` array from init-phase output, scan the `tasks` map to find tasks where the `repo` field matches the satellite name. Only process satellites that have matching tasks.

For each satellite with matching tasks:
- Run `git -C <satellite.worktreePath> status --porcelain`. If output has changes:
  - `git -C <satellite.worktreePath> add -A`
  - `git -C <satellite.worktreePath> commit -m "<phase commit message>"`
  - Record status as `"committed"` for this satellite.
- If no changes, record status as `"no-changes"` and skip.

Pass satellite status to phase-summary via `--satellites '<json>'` (e.g., `[{"name":"sat1","status":"committed"}]`).

#### 2f. Invalidate and update cache

Run `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000 --root <mainRoot> --cache-name <cacheName>`

If new Explore agents were launched during this phase, append their summaries to `<mainRoot>/.devorch/explore-cache-<cacheName>.md` before or after running manage-cache.

### 3. Final verification

After all phases complete successfully, execute the full implementation verification **inline in this context** (not as Task — so that agents are first-level Task calls).

> **Source-read rule relaxation**: The orchestrator may read source files in this step only — limited to applying trivial fixes (via Edit tool) based on reviewer findings. All deep analysis is delegated to adversarial review agents. During phase execution (step 2), source reads remain delegated to builders and Explore agents.

#### 3a. Determine changed files

Run `git -C <projectRoot> diff --name-only` against the baseline:
- If all phases complete: diff against the parent of the first `phase(1):` commit. Scan `git -C <projectRoot> log --oneline` for the first commit matching `phase(1):` and use its parent.
- If partial: diff up to the last completed phase.
- Fallback: diff against the plan commit (`chore(devorch): plan`).

#### 3b. Residual scan + adversarial review agents

**Residual scan** (quick, no file reading):

Use the Grep tool to search for `TODO|FIXME|HACK|XXX` across the changed files from 3a. Record any findings with file:line evidence. This takes seconds and keeps the orchestrator's context clean (Principle 1).

**Adversarial review agents** — scale by plan size:

Count total tasks across all phases in the plan. Launch reviewers as Task foreground calls (`subagent_type="Explore"`), all parallel in a single message:

- **1-2 tasks** → **1 combined reviewer** (security + quality + completeness + cross-phase integration in one prompt)
- **3-5 tasks** → **2 reviewers**: security-reviewer + quality-completeness-reviewer (quality, completeness, and cross-phase integration combined)
- **6+ tasks** → **3 reviewers**: security-reviewer + quality-reviewer + completeness-reviewer

**All reviewers receive:**
- `Working directory: <projectRoot>`
- Plan objective + description (NOT source code)
- CONVENTIONS.md content
- List of changed files
- **All file reads and git commands must use `<projectRoot>` as the base path**
- Each explores the code INDEPENDENTLY — as if unfamiliar with the implementation
- **Effort guidance**: Analyze deeply. Look for subtle bugs, security issues, and edge cases that builders might miss. Thoroughness matters more than speed here.

**Reviewer mandates:**
- **security-reviewer**: vulnerabilities, injection risks, auth issues, data exposure, secrets
- **quality-reviewer**: edge cases, error handling, correctness, maintainability
- **completeness-reviewer**: everything from the plan was implemented? anything missing? behavior matches spec? Implementation matches `<spec>` contracts — function signatures, error handling, behavioral pre/postconditions, API response shapes. Cross-phase integration — imports resolve across module boundaries, no orphan exports, handoff contracts honored between phases, type consistency across modules

All adversarial agents block as foreground Task calls.

#### 3c. Code review fixes

Collect results from: residual scan, adversarial reviewers.

Classify each finding into one of three tiers:

- **Trivial** (1-2 files, fix is self-evident, no ambiguity): fix directly with Edit tool. Examples: leftover TODO/FIXME, unused import, typo, formatting, missing semicolon.
- **Fix-level** (well-defined fix, obvious approach, no design decisions, but touches 3+ files OR requires non-trivial logic): launch a devorch-builder Task agent (`subagent_type="devorch-builder"`) as a foreground call. The builder prompt includes: `Working directory: <projectRoot>`, finding description with file:line evidence from reviewers, affected files list, CONVENTIONS.md content, specific instruction to fix and commit. **Effort guidance for fix-level builders**: Debug thoroughly. Understand root cause before fixing. These are issues that reviewers caught — reason carefully about why they were missed. Examples: rename type across files, add missing error handling to multiple endpoints, fix consistent pattern violation across modules.
- **Talk-level** (requires design decisions, multiple valid approaches, architectural impact, or scope too large to fix without planning): do NOT fix. Generate a ready-to-paste prompt:
  ```
  /devorch:talk <detailed description including: what's wrong, which files are affected, what the reviewers found, why it needs planning>
  ```

**Fix execution** (batch by file):

**Skip-on-zero-findings**: If all adversarial reviewers AND the residual scan report zero findings, skip the fix execution AND the post-review check entirely. The last phase's `check-project.ts` already validated everything — no need to re-run.

Otherwise:

1. **Batch trivial fixes by file**: Group all trivial findings by file path. For each file, apply ALL fixes in a single Edit call sequence before moving to the next file. Do not interleave edits across files.
2. Launch builder agents for all fix-level findings (parallel foreground Task calls in a single message).
3. After trivial fixes are applied, commit them: `fix(review): <concise description of fixes>`. Fix-level builders commit their own changes separately.
4. Escalate any talk-level findings to `/devorch:talk` prompts.

**Post-review check** (with 1 retry for fix-level builders):

After review fixes are committed, determine check intensity based on fix tiers applied:
- **Trivial fixes only** (no fix-level builders launched): run with `--quick` — build + typecheck only. Lint and tests already passed in per-phase checks; cosmetic fixes don't warrant a full re-run.
- **Fix-level fixes** (any fix-level builder launched): run full check.

```bash
bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> [--quick]
```

Append `--no-test` only if `noTests` is true (applies to full checks only). Parse the JSON output.

- If all checks pass: proceed to verdict.
- If any check fails (lint, typecheck, build, test): diagnose which fix-level builder's changes caused the failure. Re-launch that specific builder with error context (1 retry max, `subagent_type="devorch-builder"`). After retry, run `check-project.ts` once more.
  - If retry passes: proceed to verdict.
  - If retry fails or no fix-level builder is responsible: report failures in the verdict as FAIL with specific details.

#### 3d. Report

```
## Verificação Final: <plan name>

### Residual Scan
<TODO/FIXME findings ou "✅ clean">

### Review Adversarial
Security: <findings ou "✅ clean">
Quality: <findings ou "✅ clean">
Completeness: <findings ou "✅ clean">

### Correções de Review
<N issues corrigidos inline, M via builder agents> (ou "Nenhum")

### Post-Review Check
Lint: ✅/❌  Typecheck: ✅/❌  Build: ✅/❌  Tests: ✅/❌ (N/M) OR ⏭ SKIPPED (if `noTests`)

### Issues Pendentes
<prompts /devorch:talk gerados> (ou "Nenhum")

### Verdict: PASS / PASS com N issues pendentes / FAIL
```

### 4. Merge worktree

After a successful build:

1. Detect the worktree branch name: `git -C <projectRoot> branch --show-current` → e.g., `devorch/feature-b`.
2. Detect the main branch: use the branch the worktree was created from (typically `master` or `main`). Run `git log --oneline <mainBranch>..<worktreeBranch>` to show what will be merged.
3. **Detect satellites**: Read the plan file and parse `<secondary-repos>`. For each secondary repo, resolve its worktree path: `<repoPath>/.worktrees/<worktreeName>` (where `worktreeName` is the last segment of `<projectRoot>`). Verify each satellite worktree exists via `git -C <repoPath> worktree list`.
4. Ask the user via `AskUserQuestion`:
   - **"Merge now"** — Merge the worktree branch into the main branch and clean up (all repos).
   - **"Keep worktree"** — Leave the worktree and branch for manual merge later.

If **merge**:

5. **Pre-flight: stash dirty repos** — For each repo (primary + all satellites detected in step 3), check for uncommitted tracked changes and stash them before merging:

   For each repo, run `git -C <repoMainPath> status --porcelain` and filter out lines starting with `??` (untracked files). If any tracked changes remain:
   ```bash
   git -C <repoMainPath> stash push -m "devorch-pre-merge"
   ```
   Record that this repo was stashed. If no tracked changes exist, skip stash and record the repo as clean.

   Report: "Stashed changes in N repos: `<list>`" or "All repos clean, proceeding."

**With satellites (coordinated merge)**:

a. **Dry-run all repos first** — For each repo (primary + all satellites), run:
```bash
git -C <repoMainPath> merge --no-commit --no-ff <worktreeBranch>
git -C <repoMainPath> merge --abort
```
If any dry-run fails: restore stashed changes in all repos that were stashed before reporting the conflict:
```bash
git -C <repoMainPath> stash pop
```
Report which repo has conflicts between branches and stop. Do NOT merge any repo.

b. **Merge sequentially** (only if all dry-runs pass) — Primary first, then satellites in order:
```bash
git checkout <mainBranch>
git merge <worktreeBranch>
```

b2. **Restore stashed changes** — After all merges succeed, for each repo that was stashed in step 5:
```bash
git -C <repoMainPath> stash pop
```
If `stash pop` fails (exit code != 0): run `git -C <repoMainPath> status --porcelain` to list conflicting files. Report to the user: "Stash pop conflict in `<repo>`: `<file list>`. Resolve manually with `git mergetool` or edit the files, then `git add` and `git stash drop`." Stop — do NOT continue cleanup or pop stash in remaining repos.

If `stash pop` succeeds: the stash is auto-removed, continue to next repo.

c. **Fix migration journal** (Drizzle projects only) — Run `bun $CLAUDE_HOME/devorch-scripts/fix-migration-journal.ts --root <primaryMainPath>`. If `fixed > 0`, include the journal file in the cleanup commit. This prevents silent migration skips when worktrees generate migrations with out-of-order timestamps.

d. **Post-merge cleanup** — Archive the plan and remove stale devorch files from the main repo:

1. Run `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan <planPath>` to archive the plan (use the resolved `planPath` from step 0, which already points to the correct `<name>.md` or `current.md` fallback).
2. Delete `.devorch/state.md` from the main repo if it exists.
3. Delete `.devorch/explore-cache-<cacheName>.md` from the main repo if it exists. Also delete `.devorch/explore-cache.md` if it exists (backward compat cleanup).
4. Delete `.devorch/project-map.md` from the main repo if it exists.
5. Run `git status --porcelain .devorch/`. If there are changes, commit: `chore(devorch): cleanup post-merge <planName>`.

e. **Cleanup all repos** — For each repo (primary + satellites):
```bash
git -C <repoMainPath> worktree remove <worktreePath>
git -C <repoMainPath> branch -d <worktreeBranch>
```

Report: "Merged `<worktreeBranch>` into `<mainBranch>` across N repos. All worktrees removed."

**Without satellites** (standard merge):

Run pre-flight stash for the primary repo as described in step 5 above.

a. **Dry-run**:
```bash
git merge --no-commit --no-ff <worktreeBranch>
git merge --abort
```
If dry-run fails and the repo was stashed: run `git stash pop` to restore changes. Report the conflict between branches and stop.

b. **Merge**:
```bash
git checkout <mainBranch>
git merge <worktreeBranch>
```

b2. **Restore stashed changes** — If the primary repo was stashed in step 5:
```bash
git stash pop
```
If `stash pop` fails (exit code != 0): run `git status --porcelain` to list conflicting files. Report to the user: "Stash pop conflict: `<file list>`. Resolve manually with `git mergetool` or edit the files, then `git add` and `git stash drop`." Stop — do NOT continue cleanup.

If `stash pop` succeeds: the stash is auto-removed, continue.

c. **Fix migration journal** (Drizzle projects only) — Run `bun $CLAUDE_HOME/devorch-scripts/fix-migration-journal.ts --root <mainRoot>`. If `fixed > 0`, include the journal file in the cleanup commit.

d. **Post-merge cleanup** — Archive the plan and remove stale devorch files from the main repo:

1. Run `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan <planPath>` to archive the plan (use the resolved `planPath` from step 0, which already points to the correct `<name>.md` or `current.md` fallback).
2. Delete `.devorch/state.md` from the main repo if it exists.
3. Delete `.devorch/explore-cache-<cacheName>.md` from the main repo if it exists. Also delete `.devorch/explore-cache.md` if it exists (backward compat cleanup).
4. Delete `.devorch/project-map.md` from the main repo if it exists.
5. Run `git status --porcelain .devorch/`. If there are changes, commit: `chore(devorch): cleanup post-merge <planName>`.

e. **Cleanup**:
```bash
git worktree remove <projectRoot>
git branch -d <worktreeBranch>
```
Report: "Merged `<worktreeBranch>` into `<mainBranch>`. Worktree removed."

If merge has conflicts: report the conflicting files and repo, and instruct the user to resolve manually. Do NOT force or auto-resolve.

If **keep**: Report: "Worktree kept at `<projectRoot>` (branch `<worktreeBranch>`). Merge manually when ready: `git merge <worktreeBranch>`"

## Rules

- Do not narrate actions. Execute directly without preamble.
- Phases run sequentially — phase logic executes inline (no phase agent delegation).
- Stop on first failure after retries are exhausted (3 retries per task). Report which phase and task failed, including all retry context.
- The orchestrator reads devorch files (`.devorch/*`, plan, state) but never reads source code files during phase execution. During review (step 3), source reads are limited to applying trivial fixes — all deep analysis is delegated to adversarial review agents.
- **Context discipline**: builders run in isolated Task contexts with only task-specific conventions and cache (from `conventionsByTask` and `cacheByTask`). The orchestrator coordinates via scripts that return JSON — not by reading code.
- Final verification runs INLINE (not as Task) so that Explore/review agents are first-level Task calls.
- Auto-fix trivial and fix-level findings. Only escalate talk-level issues with `/devorch:talk` prompt.
- **Language policy**: User-facing output (questions, reports, summaries, progress messages) in Portuguese pt-BR with correct accentuation (e.g., "não", "ação", "é", "código", "será"). Code, git commits, internal files, and technical documentation in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese text.
