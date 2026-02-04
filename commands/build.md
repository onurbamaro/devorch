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
   - Use `TaskCreate` for each task in the phase. Set up dependencies with `TaskUpdate` + `addBlockedBy` following the wave structure.
   - Deploy builders via `Task` tool following the **Execution** waves. All tasks in a wave launch as parallel agents in a single message. Wait for a wave to complete before starting the next.
   - Each builder prompt must include: the full task details inline (so builders skip TaskGet), the conventions content inline (so builders skip reading the file), `run bun ~/.claude/devorch-scripts/check-project.ts after completing`, `commit with type(scope): description`, and `mark task completed via TaskUpdate`.
   - The last wave is always validation: run the phase's **Validation Commands**, run `check-project.ts`, and verify **Acceptance Criteria**.

3. **Phase commit**: If there are uncommitted changes after validation passes, commit: `phase(N): <goal summary>`

4. **Update state**: Write `.devorch/state.md`:
   ```markdown
   # devorch State
   - Plan: .devorch/plans/current.md
   - Last completed phase: N
   - Status: ready for phase N+1
   ## Phase N Summary
   <what was done>
   ```

5. **Report**: What was done, any issues, next step: `/devorch:build N+1`

## Rules

- Do not narrate actions. Execute directly without preamble.
- Execute **ONE phase** per invocation.
- If a builder fails, report and stop.
- Always update state.md, even on partial failure.
