---
description: Executes all remaining phases of the current devorch plan
argument-hint: [--plan <name>] [--no-tests]
model: opus
---

Execute all remaining phases of the plan automatically, then verify the full implementation.

**Continues from last checkpoint.** Picks up from where the last session left off via `state.md`.

**Input**: `$ARGUMENTS` may contain:
- `--plan <name>` to specify which plan to build. The value can be:
  - A **worktree name** (e.g., `--plan feature-b`) → resolves to `.worktrees/feature-b/.devorch/plans/current.md`
  - A **full path** (contains `/` or ends in `.md`) → used as-is
  - Omitted → auto-detects from active worktrees
- `--no-tests` (optional boolean flag) → skip tests in the post-review check (3c). When set, the post-review `check-project.ts` receives `--no-test` and the report shows tests as skipped. Parse this flag early alongside `--plan` and store as `noTests = true/false`.

## Workflow

### 0. Resolve plan path

Parse `$ARGUMENTS` for `--plan <value>` and `--no-tests` (boolean, defaults to false).

**Resolution logic:**
1. If `--plan <value>` provided:
   - If value contains `/` or ends in `.md` → treat as full path. Derive `projectRoot` by stripping `/.devorch/plans/<filename>` from the path.
   - Otherwise → treat as worktree name. Set `planPath = .worktrees/<value>/.devorch/plans/current.md`, `projectRoot = .worktrees/<value>`.
2. If `--plan` NOT provided:
   - Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON output.
   - If `count == 0`: report error "No active worktrees. Run `/devorch:talk` first." and stop.
   - If `count == 1`: auto-detect. Set `planPath = .worktrees/<name>/.devorch/plans/current.md`, `projectRoot = .worktrees/<name>`. Report: "Auto-detected worktree: `<name>` (<planTitle>)"
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

Parse JSON output. If `contentFile` field is present, read that file for full phase context. Otherwise use the `content` field directly. This provides: plan objective, decisions, solution approach, phase content, previous handoff, conventions, current state, filtered explore-cache, structured waves and tasks, and `specsByTask` (spec contracts extracted from the plan's `<spec>` section, filtered per task by **Spec refs**).

#### 2b. Explore

Check the explore cache (included in init-phase output) for areas relevant to this phase's tasks. If the explore-cache contains sections that cover ALL files in `<relevant-files>` for this phase, do NOT launch Explore agents — the cache already provides sufficient context. Only launch Explore agents (use the **Task tool call** with `subagent_type="Explore"`) for areas with partial or missing coverage in cache. Append new summaries to explore-cache.

#### 2c. Deploy builders

For each wave from init-phase output, use `TaskCreate` with wave dependencies via `addBlockedBy`. Deploy builders using the **Task tool call** (never Bash/CLI) with `subagent_type="devorch-builder"` as **foreground parallel** calls following the wave structure.

- For `"parallel"` and `"sequential"` type waves: launch all taskIds as parallel Task calls **in a single message** (do NOT use `run_in_background`). The Task calls block until all builders in the wave return — no polling needed.

Each builder prompt includes:
- Plan's **Objective** (from init-phase output), **Solution Approach** (if present), **Decisions** (if present)
- Full task details inline from the `tasks` map (builders skip TaskGet)
- Convention sections from `conventionsByTask[taskId]` — pre-filtered by init-phase.ts based on file extensions in the task
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
- **First failure (0 retries)**: Use the Task result output to diagnose the issue. Re-launch the task with an additional note describing the previous failure. Increment retry counter.
- **After 1 retry**: Stop and report the failure. Do not retry further.

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

#### 2g. Verify completion

Read `<projectRoot>/.devorch/state.md`. Check that `Last completed phase:` shows N.
- If verified → report "Phase N/Y complete." and continue to next phase.
- If NOT verified → stop and report: "Phase N did not complete successfully."

### 3. Final verification

After all phases complete successfully, execute the full implementation verification **inline in this context** (not as Task — so that agents are first-level Task calls).

> **Source-read rule relaxation**: The orchestrator reads source files directly in this step only (review phase). During phase execution (step 2), source reads remain delegated to builders and Explore agents.

#### 3a. Determine changed files

Run `git -C <projectRoot> diff --name-only` against the baseline:
- If all phases complete: diff against the parent of the first `phase(1):` commit. Scan `git -C <projectRoot> log --oneline` for the first commit matching `phase(1):` and use its parent.
- If partial: diff up to the last completed phase.
- Fallback: diff against the plan commit (`chore(devorch): plan`).

#### 3b. Inline cross-phase verification + launch review agents

Perform the cross-phase verification **inline** (no Explore agent) and launch adversarial reviewers **in parallel in the same message**:

**Inline cross-phase check** (orchestrator reads diff files directly):

Using the changed files list from 3a, read each changed file with the Read tool and verify:
- Imports resolve — no references to moved/renamed/deleted modules
- No orphan exports — exported symbols are imported somewhere
- No leftover `TODO`/`FIXME`/`HACK`/`XXX` from builders
- Type consistency across module boundaries
- No dead code introduced
- Handoff contracts honored between phases

Record findings with file:line evidence. This runs inline while the adversarial reviewers execute in parallel.

**3 adversarial review agents** — Task foreground, all parallel in the same message (`subagent_type="Explore"`):
- **Effort guidance for reviewers**: Analyze deeply. Look for subtle bugs, security issues, and edge cases that builders might miss. Thoroughness matters more than speed here.
- Each agent receives: `Working directory: <projectRoot>`, plan objective + description (NOT source code), CONVENTIONS.md, list of changed files
- **All file reads and git commands must use `<projectRoot>` as the base path**
- Each explores the code INDEPENDENTLY — as if unfamiliar with the implementation
- **security-reviewer**: vulnerabilities, injection risks, auth issues, data exposure, secrets
- **quality-reviewer**: edge cases, error handling, correctness, maintainability
- **completeness-reviewer**: everything from the plan was implemented? anything missing? behavior matches spec? Implementation matches `<spec>` contracts — function signatures, error handling, behavioral pre/postconditions, API response shapes

All 3 adversarial agents block as foreground Task calls.

#### 3c. Code review fixes

Collect results from: inline cross-phase check, 3 adversarial reviewers.

Classify each finding into one of three tiers:

- **Trivial** (1-2 files, fix is self-evident, no ambiguity): fix directly with Edit tool. Examples: leftover TODO/FIXME, unused import, typo, formatting, missing semicolon.
- **Fix-level** (well-defined fix, obvious approach, no design decisions, but touches 3+ files OR requires non-trivial logic): launch a devorch-builder Task agent (`subagent_type="devorch-builder"`) as a foreground call. The builder prompt includes: `Working directory: <projectRoot>`, finding description with file:line evidence from reviewers, affected files list, CONVENTIONS.md content, specific instruction to fix and commit. **Effort guidance for fix-level builders**: Debug thoroughly. Understand root cause before fixing. These are issues that reviewers caught — reason carefully about why they were missed. Examples: rename type across files, add missing error handling to multiple endpoints, fix consistent pattern violation across modules.
- **Talk-level** (requires design decisions, multiple valid approaches, architectural impact, or scope too large to fix without planning): do NOT fix. Generate a ready-to-paste prompt:
  ```
  /devorch:talk <detailed description including: what's wrong, which files are affected, what the reviewers found, why it needs planning>
  ```

**Fix execution** (batch by file):

**Skip-on-zero-findings**: If all 3 adversarial reviewers AND the inline cross-phase check report zero findings, skip the fix execution AND the post-review check entirely. The last phase's `check-project.ts` already validated everything — no need to re-run.

Otherwise:

1. **Batch trivial fixes by file**: Group all trivial findings by file path. For each file, apply ALL fixes in a single Edit call sequence before moving to the next file. Do not interleave edits across files.
2. Launch builder agents for all fix-level findings (parallel foreground Task calls in a single message).
3. After trivial fixes are applied, commit them: `fix(review): <concise description of fixes>`. Fix-level builders commit their own changes separately.
4. Escalate any talk-level findings to `/devorch:talk` prompts.

**Post-review check** (with 1 retry for fix-level builders):

After review fixes are committed, run automated checks inline:

```bash
bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot>
```

Append `--no-test` only if `noTests` is true. Parse the JSON output.

- If all checks pass: proceed to verdict.
- If any check fails (lint, typecheck, build, test): diagnose which fix-level builder's changes caused the failure. Re-launch that specific builder with error context (1 retry max, `subagent_type="devorch-builder"`). After retry, run `check-project.ts` once more.
  - If retry passes: proceed to verdict.
  - If retry fails or no fix-level builder is responsible: report failures in the verdict as FAIL with specific details.

#### 3d. Report

```
## Verificação Final: <plan name>

### Integração Cross-phase
<findings do Explore agent ou "✅ OK">

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

c. **Post-merge cleanup** — Archive the plan and remove stale devorch files from the main repo:

1. Run `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan <worktreePath>/.devorch/plans/current.md` to archive the plan.
2. Delete `.devorch/state.md` from the main repo if it exists.
3. Delete `.devorch/explore-cache-<cacheName>.md` from the main repo if it exists. Also delete `.devorch/explore-cache.md` if it exists (backward compat cleanup).
4. Delete `.devorch/project-map.md` from the main repo if it exists.
5. Run `git status --porcelain .devorch/`. If there are changes, commit: `chore(devorch): cleanup post-merge <planName>`.

d. **Cleanup all repos** — For each repo (primary + satellites):
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

c. **Post-merge cleanup** — Archive the plan and remove stale devorch files from the main repo:

1. Run `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan <worktreePath>/.devorch/plans/current.md` to archive the plan.
2. Delete `.devorch/state.md` from the main repo if it exists.
3. Delete `.devorch/explore-cache-<cacheName>.md` from the main repo if it exists. Also delete `.devorch/explore-cache.md` if it exists (backward compat cleanup).
4. Delete `.devorch/project-map.md` from the main repo if it exists.
5. Run `git status --porcelain .devorch/`. If there are changes, commit: `chore(devorch): cleanup post-merge <planName>`.

d. **Cleanup**:
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
- Stop on first failure. Report which phase failed.
- The orchestrator reads devorch files (`.devorch/*`, plan, state) but never reads source code files during phase execution. Source code reads are allowed only during review (step 3).
- **Context discipline**: builders run in isolated Task contexts with only task-specific conventions and cache (from `conventionsByTask` and `cacheByTask`). The orchestrator coordinates via scripts that return JSON — not by reading code.
- Final verification runs INLINE (not as Task) so that Explore/review agents are first-level Task calls.
- Auto-fix trivial and fix-level findings. Only escalate talk-level issues with `/devorch:talk` prompt.
- **Language policy**: User-facing output (questions, reports, summaries, progress messages) in Portuguese pt-BR with correct accentuation (e.g., "não", "ação", "é", "código", "será"). Code, git commits, internal files, and technical documentation in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese text.
