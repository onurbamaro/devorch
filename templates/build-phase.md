Execute one phase of the current devorch plan.

**Input**: $ARGUMENTS (phase number). If not provided, read `.devorch/state.md` and suggest the next phase. If no state exists, start with Phase 1. If state exists but its `Plan:` field doesn't match the current plan title (first `# Plan:` heading in `.devorch/plans/current.md`), **ignore the stale state** and start with Phase 1.

## Workflow

1. **Init phase**: Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan .devorch/plans/current.md --phase N`

   Parse JSON output. If `contentFile` field is present, read that file for full phase context. Otherwise use the `content` field directly. This provides: plan objective, decisions, solution approach, phase content, previous handoff, conventions, current state, and filtered explore-cache — no separate Read calls needed.

2. **Explore**: Check the explore cache (included in init-phase output) for areas relevant to this phase's tasks. Launch Explore agents (use the **Task tool call** with `subagent_type="Explore"`) for any area not fully covered in cache. The phrase "eu já sei o suficiente" é uma racionalização — Explore agents existem para fornecer contexto confiável, não sua memória. Append new summaries to explore-cache.

3. **Extract waves**: Run `bun $CLAUDE_HOME/devorch-scripts/extract-waves.ts --plan .devorch/plans/current.md --phase N`

   Parse the JSON output to get the structured `waves` array and `tasks` map. Use these to determine launch order and task content for builder prompts.

4. **Deploy builders**: For each wave from extract-waves output, use `TaskCreate` with wave dependencies via `addBlockedBy`. Deploy builders using the **Task tool call** (never Bash/CLI) with `subagent_type="devorch-builder"` as **foreground parallel** calls following the wave structure.

   - For `"parallel"` and `"sequential"` type waves: launch all taskIds as parallel Task calls **in a single message** (do NOT use `run_in_background`). The Task calls block until all builders in the wave return — no polling needed.
   - For `"validation"` type waves: handled in step 6 below (not here).

   Each builder prompt includes:
   - Plan's **Objective** (from init-phase output), **Solution Approach** (if present), **Decisions** (if present)
   - Full task details inline from the `tasks` map (builders skip TaskGet)
   - Convention sections matched by **file extension** — include ALL sections matching extensions in the task (e.g., `.tsx` → React + TypeScript + style conventions; `.ts` → TypeScript conventions; `.css`/`.scss` → style conventions). Never filter by perceived "relevance" — inclua toda seção cujas extensões aparecem no task.
   - Filtered Explore context for that specific task (not all summaries to all builders)
   - `commit with type(scope): description`
   - `CRITICAL: call TaskUpdate with status "completed" as your very last action`

   Do NOT include check-project.ts instructions — the builder agent definition already handles validation.

   After all builders in a wave return, verify via `TaskList` that every task is marked completed.

   **On builder failure** (task not marked completed after Task call returned, or no matching commit in `git log`):
   - **First failure (0 retries)**: Use the Task result output to diagnose the issue. Re-launch the task with an additional note describing the previous failure. Increment retry counter.
   - **After 1 retry**: Stop and report the failure. Do not retry further.

5. **Run validation commands**: Run `bun $CLAUDE_HOME/devorch-scripts/run-validation.ts --plan .devorch/plans/current.md --phase N`

   Parse JSON output:
   - If all commands pass (`failed === 0`): proceed to step 6 with no validation issues.
   - If any command fails: include the failure output in the validator's prompt context (step 6) so it can assess whether it's a real problem.

6. **Deploy validator**: Deploy validator in foreground (use the **Task tool call** with `subagent_type="devorch-validator"`). Its prompt includes inline: phase **criteria** (from `<criteria>`), task summaries, relevant conventions, and any validation command failures from step 5. The validator focuses solely on **acceptance criteria verification** by reading code — it does not run validation commands (step 5 handles that). If FAIL → stop and report.

7. **Phase commit**: If there are uncommitted changes after validation passes:
   - Run `bun $CLAUDE_HOME/devorch-scripts/format-commit.ts --plan .devorch/plans/current.md --phase N`
   - Use the `message` field from the JSON output as the git commit message.

8. **Invalidate and update cache**: Run `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000`

   If new Explore agents were launched during this phase, append their summaries to `.devorch/explore-cache.md` before or after running manage-cache.

9. **Update state**: Run `bun $CLAUDE_HOME/devorch-scripts/update-state.ts --plan .devorch/plans/current.md --phase N --status "ready for phase $((N+1))" --summary "<concise phase summary>"`

   This deterministically: archives the old phase summary to state-history.md, writes the new state.md with the latest phase summary only.

10. **Report**: What was done and any issues encountered.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Execute **ONE phase** per invocation.
- The orchestrator never reads source code files. Use Explore agents for codebase context. Only read devorch files (`.devorch/*`).
- Deploy builders as **foreground parallel** Task calls — never use `run_in_background` for builders.
- If a builder fails, report and stop.
- Always update state.md (step 9), even on partial failure.
