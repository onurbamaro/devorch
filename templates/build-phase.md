Execute one phase of the current devorch plan.

**Input**: $ARGUMENTS (phase number). If not provided, read `.devorch/state.md` and suggest the next phase. If no state exists, start with Phase 1. If state exists but its `Plan:` field doesn't match the current plan title (first `# Plan:` heading in `.devorch/plans/current.md`), **ignore the stale state** and start with Phase 1.

## Workflow

1. **Extract phase**: Run `bun $CLAUDE_HOME/devorch-scripts/extract-phase.ts --plan .devorch/plans/current.md --phase N`

2. **Load context from disk**: Read `.devorch/CONVENTIONS.md` and `.devorch/explore-cache.md` (if they exist). If this is phase 2+, read `.devorch/state.md` for the previous phase handoff (it contains only the last completed phase's summary — this is the only inter-phase context needed).

3. **Explore (conditional)**: Check explore cache for areas relevant to this phase's tasks. Launch Explore agents (use the **Task tool call** with `subagent_type="Explore"`) only for uncovered or stale areas. Append new summaries to explore-cache.

4. **Deploy builders**: For each task, use `TaskCreate` with wave dependencies via `addBlockedBy`. Deploy builders using the **Task tool call** (never Bash/CLI) with `subagent_type="devorch-builder"` as **foreground parallel** calls following the wave structure. All tasks in a wave launch as parallel Task calls **in a single message** (do NOT use `run_in_background`). The Task calls block until all builders in the wave return — no polling needed.

   Each builder prompt includes:
   - Plan's **Objective** (from `<objective>`), **Solution Approach** (from `<solution-approach>`, if exists), **Decisions** (from `<decisions>`, if exists)
   - Full task details inline (builders skip TaskGet)
   - Only the **relevant sections** of conventions — match convention sections to task file types (e.g., `.tsx` files → include React patterns, naming, and style conventions; backend-only tasks → skip UI conventions). When in doubt about relevance, include the section.
   - Filtered Explore context for that specific task (not all summaries to all builders)
   - `commit with type(scope): description`
   - `CRITICAL: call TaskUpdate with status "completed" as your very last action`

   Do NOT include check-project.ts instructions — the builder agent definition already handles validation.

   After all builders in a wave return, verify via `TaskList` that every task is marked completed.

   **On builder failure** (task not marked completed after Task call returned, or no matching commit in `git log`):
   - **First failure (0 retries)**: Use the Task result output to diagnose the issue. Re-launch the task with an additional note describing the previous failure. Increment retry counter.
   - **After 1 retry**: Stop and report the failure. Do not retry further.

5. **Validate**: Deploy validator in foreground (use the **Task tool call** with `subagent_type="devorch-validator"`). Its prompt includes inline: phase **criteria** (from `<criteria>`), **validation commands** (from `<validation>`), task summaries, relevant conventions. If FAIL → stop and report.

6. **Phase commit**: If there are uncommitted changes after validation passes, commit: `phase(N): <goal summary>`

7. **Invalidate and update cache**: After the phase commit, run `git diff --name-only HEAD~1..HEAD` to get files changed in this phase. For each section in `.devorch/explore-cache.md`, check if any of its described files overlap with the changed files. If so, **delete that cache section** (it's now stale — builders changed those files). Then, if new Explore agents were launched during this phase, append their summaries.

   **Cache size management**: After updating, check if explore-cache.md exceeds 3000 lines. If so, trim oldest sections (those not referenced by current or next phase's relevant files) until under the limit. Sections are ordered by position — remove from top first.

8. **Update state**:
   - If `.devorch/state.md` already exists and has a `## Phase` summary section, **append that section** to `.devorch/state-history.md` (create if needed). This preserves full history without bloating the active state file.
   - Then **overwrite** `.devorch/state.md`:
   ```markdown
   # devorch State
   - Plan: <plan title from first heading of current.md>
   - Last completed phase: N
   - Status: ready for phase N+1
   ## Phase N Summary
   <what was done — concise, max 5 lines>
   ```
   state.md must contain **only the latest phase summary**. Previous summaries live in `state-history.md` and are never loaded during builds.

9. **Report**: What was done and any issues encountered.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Execute **ONE phase** per invocation.
- The orchestrator never reads source code files. Use Explore agents for codebase context. Only read devorch files (`.devorch/*`).
- Deploy builders as **foreground parallel** Task calls — never use `run_in_background` for builders.
- If a builder fails, report and stop.
- Always update state.md, even on partial failure.
