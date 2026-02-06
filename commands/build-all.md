---
description: Executes all remaining phases of the current devorch plan
model: opus
---

Execute all remaining phases of the plan automatically, then verify the full implementation.

The orchestrator is **stateless between phases** — it reads plan + state from disk at each iteration. Context compression is irrelevant because the plan file is the source of truth, and each builder/validator agent gets fresh context in its prompt.

**Continues from last checkpoint.** If the user already ran some phases with `/devorch:build`, build-all picks up from where they left off via `state.md`.

## Workflow

### 1. Determine scope

- Read the plan title from `.devorch/plans/current.md` (first `# Plan: <name>` heading)
- Read `.devorch/state.md` (if exists):
  - Check `Plan:` field matches the current plan title. If mismatch → stale state from a previous plan → start from phase 1.
  - If match → read `Last completed phase: K` → start from phase K+1
  - If no state file → start from phase 1
- Count phase tags (`<phaseN`) in the plan → total phases
- If all phases already complete, report "All N phases already complete" and stop
- Report: "Executing phases X through Y (Z total)"

### 2. Phase loop

For each remaining phase N (sequentially):

**a. Extract phase**

Run `bun $CLAUDE_HOME/devorch-scripts/extract-phase.ts --plan .devorch/plans/current.md --phase N`. This returns the phase goal, tasks, waves, acceptance criteria, and validation commands — everything the orchestrator needs for this iteration.

**b. Load context from disk**

Read these for the current phase:
- `.devorch/CONVENTIONS.md` (if exists)
- `.devorch/explore-cache.md` (if exists)

These are re-read each iteration. If context was compressed since the last phase, it doesn't matter — we have the data fresh from disk.

**c. Explore (conditional)**

Check explore cache for areas relevant to this phase's tasks. Launch Explore agents (`Task` with `subagent_type=Explore`) only for uncovered or stale areas. After exploring, append new summaries to `.devorch/explore-cache.md`.

**d. Create tasks**

Use `TaskCreate` for each task in the phase. Set wave dependencies with `TaskUpdate` + `addBlockedBy` per the Execution section.

**e. Save git baseline**

Before launching the first wave, record the current HEAD: `git rev-parse HEAD`. Used as fallback to detect builder work if TaskUpdate fails.

**f. Execute waves**

For each wave:

1. **Launch builders in background**: For each task in the wave, deploy `Task` with `subagent_type=devorch-builder` and `run_in_background=true`. Each builder prompt includes:
   - Plan's **Objective** (from `<objective>`), **Solution Approach** (from `<solution-approach>`, if exists), **Decisions** (from `<decisions>`, if exists)
   - Full task details inline (builders skip TaskGet)
   - Only the **relevant sections** of conventions
   - Filtered Explore context for that specific task
   - `commit with type(scope): description`
   - `CRITICAL: call TaskUpdate with status "completed" as your very last action — the pipeline stalls without this`

   Do NOT include check-project.ts instructions — the builder agent definition already handles validation.

2. **Poll for completion**: Call `TaskList` until all tasks in the wave show `completed`. **Do NOT call `TaskOutput`** — it pulls the full builder output into context, defeating background execution.

3. **Fallback — git-based detection**: If tasks stay `in_progress` but no builders are actively running (background processes ended), check `git log <baseline>..HEAD --oneline` for commits matching the expected scopes. If commits landed for a stuck task, mark it `completed` via `TaskUpdate` and continue.

4. **On true failure**: If a task has no commit and its background process has ended, use `Read` on the builder's output file (path returned at launch) to diagnose. Then **stop the entire build** and report.

**g. Validate**

Deploy validator in **foreground** (`Task` with `subagent_type=devorch-validator`). Its prompt includes inline: phase **criteria** (from `<criteria>`), **validation commands** (from `<validation>`), summary of what each task did, relevant conventions. The validator returns PASS or FAIL — this is the one result the orchestrator needs to read.

If FAIL: stop and report. Do not proceed to next phase.

**h. Phase commit**

If uncommitted changes remain after validation passes, commit: `phase(N): <goal summary>`

**i. Invalidate stale cache**

After the phase commit, run `git diff --name-only HEAD~1..HEAD` to get files changed in this phase. For each section in `.devorch/explore-cache.md`, check if any of its described files overlap with the changed files. If so, **delete that cache section** — it's now stale because builders modified those files. Future phases will re-explore as needed.

**j. Update state**

Write `.devorch/state.md`:
```
# devorch State
- Plan: <plan title from first heading>
- Last completed phase: N
- Status: ready for phase N+1
## Phase N Summary
<what was done>
```

**k. Progress**

Brief report: "Phase N/Y complete." Continue to next phase.

### 3. Implementation check

After all phases complete successfully, run the full implementation verification by reading and executing `$CLAUDE_HOME/commands/devorch/check-implementation.md`. This is the single source of truth for post-build verification — do not duplicate its logic here.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Phases run sequentially. Waves within a phase follow their dependency order.
- Stop on first failure (builder or validator). Report which phase/task failed and why.
- Always update state.md after each phase, even on partial failure.
- If explore cache from make-plan covers the needed areas, skip new exploration.

## Context discipline

The orchestrator reads from disk, dispatches to agents, and tracks progress. It does not analyze source code.

**NEVER do these:**
- `Read` on source code files — use Explore agents instead
- `TaskOutput` on background builders — defeats `run_in_background`
- `Grep`/`Glob` on source code — that's the builders' and explorers' job

**ALWAYS do these:**
- `TaskList` to check completion (compact status output)
- `Read` only on devorch files (`.devorch/*`, extracted phase output)
- Explore agents for any codebase understanding needed
- `run_in_background=true` for ALL builder Task agents

The orchestrator is stateless between phases. If context is compressed mid-execution, the next iteration re-reads everything it needs from disk. This is by design.
