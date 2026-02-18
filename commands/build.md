---
description: Executes all remaining phases of the current devorch plan
argument-hint: [--plan <name>]
model: opus
---

Execute all remaining phases of the plan automatically, then verify the full implementation.

**Continues from last checkpoint.** Picks up from where the last session left off via `state.md`.

**Input**: `$ARGUMENTS` may contain `--plan <name>` to specify which plan to build. The value can be:
- A **worktree name** (e.g., `--plan feature-b`) → resolves to `.worktrees/feature-b/.devorch/plans/current.md`
- A **full path** (contains `/` or ends in `.md`) → used as-is
- Omitted → auto-detects from active worktrees

## Workflow

### 0. Resolve plan path

Parse `$ARGUMENTS` for `--plan <value>`.

**Resolution logic:**
1. If `--plan <value>` provided:
   - If value contains `/` or ends in `.md` → treat as full path. Derive `projectRoot` by stripping `/.devorch/plans/<filename>` from the path.
   - Otherwise → treat as worktree name. Set `planPath = .worktrees/<value>/.devorch/plans/current.md`, `projectRoot = .worktrees/<value>`.
2. If `--plan` NOT provided:
   - Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON output.
   - If `count == 0`: report error "No active worktrees. Run `/devorch:make-plan` first." and stop.
   - If `count == 1`: auto-detect. Set `planPath = .worktrees/<name>/.devorch/plans/current.md`, `projectRoot = .worktrees/<name>`. Report: "Auto-detected worktree: `<name>` (<planTitle>)"
   - If `count > 1`: use `AskUserQuestion` to present the worktrees as options (each option shows name + plan title + status). Set `planPath` and `projectRoot` based on the user's choice.

Verify the plan file exists. If not, report error and stop.

Set `mainRoot` to the current working directory (the main repo root where `.worktrees/` lives). Plans always live in worktrees, so `isWorktree` is always true.

All `state.md`, `state-history.md`, and `build-summary.md` references in subsequent steps use `<projectRoot>/.devorch/`. All scripts receive `--plan <planPath>`.

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

Read `$CLAUDE_HOME/devorch-templates/build-phase.md` once — this is the build instructions template.

For each remaining phase N (sequentially):

1. **Launch phase agent**: Use the **Task tool call** with `subagent_type="general-purpose"`. The prompt is the full content of build-phase.md followed by: `\n\nExecute phase ${N} of the plan at <planPath>\n\nMain repo root for cache: <mainRoot>`
2. **Verify completion**: After the Task agent returns, read `<projectRoot>/.devorch/state.md`. Check that `Last completed phase:` shows N.
   - If verified → report "Phase N/Y complete." and continue to next phase.
   - If NOT verified → the phase agent handles retries internally (up to 1 retry per failed builder). If the phase still fails after retries, stop and report: "Phase N did not complete successfully. Check agent output."

### 3. Implementation check

After all phases complete successfully, run the full implementation verification **inline in this context** — read `$CLAUDE_HOME/commands/devorch/check-implementation.md` and follow its steps directly. Do NOT spawn a Task agent for check-implementation. Execute it here so that any agents it launches (Explore, Agent Teams) are first-level Task calls, not nested.

Use `<planPath>` for all `--plan` arguments in scripts called by check-implementation. The check has access to `<planPath>`, `<projectRoot>`, and `<mainRoot>`.

This is the single source of truth for post-build verification — do not duplicate its logic here.

### 4. Build summary

If the implementation check verdict is **PASS**:

1. Run `bun $CLAUDE_HOME/devorch-scripts/generate-summary.ts --plan <planPath>`
2. Stage `<projectRoot>/.devorch/build-summary.md` and commit: `chore(devorch): build summary — <plan name>`. Use `git -C <projectRoot>` for the commit.
3. Report: "Build summary saved to `<projectRoot>/.devorch/build-summary.md`"

If the verdict is **FAIL**, skip this step.

### 5. Merge worktree

After a successful build:

1. Detect the worktree branch name: `git -C <projectRoot> branch --show-current` → e.g., `devorch/feature-b`.
2. Detect the main branch: use the branch the worktree was created from (typically `master` or `main`). Run `git log --oneline <mainBranch>..<worktreeBranch>` to show what will be merged.
3. Ask the user via `AskUserQuestion`:
   - **"Merge now"** — Merge the worktree branch into the main branch and clean up.
   - **"Keep worktree"** — Leave the worktree and branch for manual merge later.

If **merge**:
```bash
git checkout <mainBranch>
git merge <worktreeBranch>
git worktree remove <projectRoot>
git branch -d <worktreeBranch>
```
Report: "Merged `<worktreeBranch>` into `<mainBranch>`. Worktree removed."

If merge has conflicts: report the conflicts and instruct the user to resolve manually. Do NOT force or auto-resolve.

If **keep**: Report: "Worktree kept at `<projectRoot>` (branch `<worktreeBranch>`). Merge manually when ready: `git merge <worktreeBranch>`"

## Rules

- Do not narrate actions. Execute directly without preamble.
- Phases run sequentially — each in its own Task agent with clean context.
- Stop on first failure. Report which phase failed.
- The orchestrator only reads `<projectRoot>/.devorch/state.md` and `<planPath>` between phases. Everything else is inside the per-phase agents.
- **Context discipline**: build is a thin supervisor. It does NOT launch builders, poll tasks, manage waves, or run validation directly. All of that is delegated to the per-phase Task agent which follows build-phase.md instructions.
