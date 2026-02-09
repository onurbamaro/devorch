---
description: Executes all remaining phases of the current devorch plan
model: opus
---

Execute all remaining phases of the plan automatically, then verify the full implementation.

**Continues from last checkpoint.** Picks up from where the last session left off via `state.md`.

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

Read `$CLAUDE_HOME/devorch-templates/build-phase.md` once — this is the build instructions template.

For each remaining phase N (sequentially):

1. **Launch phase agent**: Use the **Task tool call** with `subagent_type="general-purpose"`. The prompt is the full content of build-phase.md followed by: `\n\nExecute phase ${N} of the plan at .devorch/plans/current.md`
2. **Verify completion**: After the Task agent returns, read `.devorch/state.md`. Check that `Last completed phase:` shows N.
   - If verified → report "Phase N/Y complete." and continue to next phase.
   - If NOT verified → the phase agent handles retries internally (up to 1 retry per failed builder). If the phase still fails after retries, stop and report: "Phase N did not complete successfully. Check agent output."

### 3. Implementation check

After all phases complete successfully, run the full implementation verification by reading and executing `$CLAUDE_HOME/commands/devorch/check-implementation.md`. This is the single source of truth for post-build verification — do not duplicate its logic here.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Phases run sequentially — each in its own Task agent with clean context.
- Stop on first failure. Report which phase failed.
- The orchestrator only reads `.devorch/state.md` and `.devorch/plans/current.md` between phases. Everything else is inside the per-phase agents.
- **Context discipline**: build is a thin supervisor. It does NOT launch builders, poll tasks, manage waves, or run validation directly. All of that is delegated to the per-phase Task agent which follows build-phase.md instructions.
