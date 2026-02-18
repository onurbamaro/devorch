---
description: Executes all remaining phases of the current devorch plan
argument-hint: [--plan <path>]
model: opus
---

Execute all remaining phases of the plan automatically, then verify the full implementation.

**Continues from last checkpoint.** Picks up from where the last session left off via `state.md`.

**Input**: `$ARGUMENTS` may contain `--plan <path>` to specify a plan file. Default: `.devorch/plans/current.md`. When using a worktree plan (e.g., `--plan .worktrees/my-feature/.devorch/plans/current.md`), all paths are derived from the plan location — state.md, explore-cache, scripts all resolve relative to the plan's `.devorch/` directory.

## Workflow

### 0. Resolve plan path

Parse `$ARGUMENTS` for `--plan <path>`. If not provided, default to `.devorch/plans/current.md`.

Derive the plan's project root: strip `/plans/current.md` (or whatever the filename is) from the plan path, then go up one level from `.devorch/`. For example:
- `.devorch/plans/current.md` → project root is `.` (current directory)
- `.worktrees/my-feature/.devorch/plans/current.md` → project root is `.worktrees/my-feature`

All `state.md`, `state-history.md`, `explore-cache.md`, and `build-summary.md` references in subsequent steps use this project root's `.devorch/` directory. All scripts receive the resolved `--plan <planPath>`.

If the project root is a worktree (not `.`), all `git` and `bun` commands in phase agents must run with `cwd` set to the worktree path.

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

1. **Launch phase agent**: Use the **Task tool call** with `subagent_type="general-purpose"`. The prompt is the full content of build-phase.md followed by: `\n\nExecute phase ${N} of the plan at <planPath>`
2. **Verify completion**: After the Task agent returns, read `<projectRoot>/.devorch/state.md`. Check that `Last completed phase:` shows N.
   - If verified → report "Phase N/Y complete." and continue to next phase.
   - If NOT verified → the phase agent handles retries internally (up to 1 retry per failed builder). If the phase still fails after retries, stop and report: "Phase N did not complete successfully. Check agent output."

### 3. Implementation check

After all phases complete successfully, run the full implementation verification **inline in this context** — read `$CLAUDE_HOME/commands/devorch/check-implementation.md` and follow its steps directly. Do NOT spawn a Task agent for check-implementation. Execute it here so that any agents it launches (Explore, Agent Teams) are first-level Task calls, not nested.

Use `<planPath>` for all `--plan` arguments in scripts called by check-implementation.

This is the single source of truth for post-build verification — do not duplicate its logic here.

### 4. Build summary

If the implementation check verdict is **PASS**:

1. Run `bun $CLAUDE_HOME/devorch-scripts/generate-summary.ts --plan <planPath>`
2. Stage `<projectRoot>/.devorch/build-summary.md` and commit: `chore(devorch): build summary — <plan name>` (read the plan title from the generate-summary.ts JSON output or from `<planPath>`). If worktree, use `git -C <projectRoot>` for the commit.
3. Report: "Build summary saved to `<projectRoot>/.devorch/build-summary.md`"

If the verdict is **FAIL**, skip this step.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Phases run sequentially — each in its own Task agent with clean context.
- Stop on first failure. Report which phase failed.
- The orchestrator only reads `<projectRoot>/.devorch/state.md` and `<planPath>` between phases. Everything else is inside the per-phase agents.
- **Context discipline**: build is a thin supervisor. It does NOT launch builders, poll tasks, manage waves, or run validation directly. All of that is delegated to the per-phase Task agent which follows build-phase.md instructions.
