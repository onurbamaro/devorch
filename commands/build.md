---
description: Executes one phase of the current devorch plan
argument-hint: <phase number>
model: opus
---

Execute one phase of the current devorch plan.

**Input**: $ARGUMENTS (phase number). If not provided, read `.devorch/state.md` and suggest the next phase. If no state exists, start with Phase 1.

## Workflow

1. **Extract phase**: Run `bun ~/.claude/devorch-scripts/extract-phase.ts --plan .devorch/plans/current.md --phase N`

2. **Read and execute**: Read the extracted output. It contains the phase goal, tasks, execution waves, acceptance criteria, and validation commands. Execute it:
   - Read `.devorch/CONVENTIONS.md` once (if it exists) before deploying any builders.
   - **Load previous context**: If this is phase 2+, read `.devorch/state.md` for previous phase summaries and the plan's **Handoff** section for the prior phase. Pass relevant handoff context to Explore agents so they don't re-explore already-understood areas.
   - **Explore context**: Before deploying builders, identify which areas of the codebase are relevant to this phase's tasks. First, check if `.devorch/explore-cache.md` exists — if it does, read it and reuse cached summaries for areas already explored during planning. **Only launch new Explore agents for areas not covered by the cache or where the cache is stale** (files were modified since the cache was generated). Launch parallel `Task` agents with `subagent_type=Explore` only for uncovered areas. **CRITICAL: Do NOT read source files directly in the orchestrator. All codebase exploration must happen through Explore agents or the explore cache. The orchestrator only reads devorch files (plans, state, conventions, explore-cache). Builders read their own source files as needed.**
   - **Filter context per builder**: Each builder's prompt should include only the Explore summaries relevant to its specific task — not all summaries to all builders. Match Explore results to tasks by area/files touched.
   - Use `TaskCreate` for each task in the phase. Set up dependencies with `TaskUpdate` + `addBlockedBy` following the wave structure.
   - Deploy builders via `Task` tool following the **Execution** waves. All tasks in a wave launch as parallel agents in a single message. Wait for a wave to complete before starting the next.
   - Each builder prompt must include: the plan's **Objective**, **Solution Approach** (if exists), and **Decisions** (if exists) — these give builders the "why" behind their task; the full task details inline (so builders skip TaskGet); only the **relevant sections** of conventions (not the entire file — pick the sections that apply to the task's scope); the filtered Explore context for that task; `run bun ~/.claude/devorch-scripts/check-project.ts after completing`; `commit with type(scope): description`; and `mark task completed via TaskUpdate`.
   - The last wave is always validation: deploy a single validator agent via `Task` (devorch-validator). Its prompt must include inline: the phase's **Acceptance Criteria**, **Validation Commands**, a summary of what each task was supposed to do, and the relevant conventions sections. The validator should NOT need to call TaskGet or read CONVENTIONS.md — everything it needs is in its prompt.

3. **Phase commit**: If there are uncommitted changes after validation passes, commit: `phase(N): <goal summary>`

4. **Update cache**: If new Explore agents were launched during this phase, append their summaries to `.devorch/explore-cache.md` (update the timestamp, add new sections, replace sections for re-explored areas). This benefits future phases.

5. **Update state**: Write `.devorch/state.md`:
   ```markdown
   # devorch State
   - Plan: .devorch/plans/current.md
   - Last completed phase: N
   - Status: ready for phase N+1
   ## Phase N Summary
   <what was done>
   ```

6. **Report**: What was done, any issues, next step: `/devorch:build N+1`

## Rules

- Do not narrate actions. Execute directly without preamble.
- Execute **ONE phase** per invocation.
- **The orchestrator NEVER reads source code files directly.** Use Explore agents to gather codebase context, and pass their summaries to builders. The orchestrator only reads devorch files (`.devorch/*`), extracted phase output, and Explore agent results.
- If a builder fails, report and stop.
- Always update state.md, even on partial failure.
