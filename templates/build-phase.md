Execute one phase of the current devorch plan.

**Input**: $ARGUMENTS (phase number). If not provided, read `.devorch/state.md` and suggest the next phase. If no state exists, start with Phase 1. If state exists but its `Plan:` field doesn't match the current plan title (first `# Plan:` heading in `.devorch/plans/current.md`), **ignore the stale state** and start with Phase 1.

**Parse `mainRoot`**: Extract `mainRoot` from the prompt context — look for "Main repo root for cache: <path>" appended by build.md. If not found, default `mainRoot` to the current working directory (backward compatibility).

## Workflow

1. **Init phase**: Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan .devorch/plans/current.md --phase N --cache-root <mainRoot>`

   Parse JSON output. If `contentFile` field is present, read that file for full phase context. Otherwise use the `content` field directly. This provides: plan objective, decisions, solution approach, phase content, previous handoff, conventions, current state, filtered explore-cache, and structured waves and tasks — no separate Read calls needed.

2. **Explore**: Check the explore cache (included in init-phase output) for areas relevant to this phase's tasks. If the explore-cache contains sections that cover ALL files in `<relevant-files>` for this phase, do NOT launch Explore agents — the cache already provides sufficient context. Only launch Explore agents (use the **Task tool call** with `subagent_type="Explore"`) for areas with partial or missing coverage in cache. The phrase "eu já sei o suficiente" é uma racionalização — Explore agents existem para fornecer contexto confiável, não sua memória. Append new summaries to explore-cache.

3. **Deploy builders**: For each wave from init-phase output, use `TaskCreate` with wave dependencies via `addBlockedBy`. Deploy builders using the **Task tool call** (never Bash/CLI) with `subagent_type="devorch-builder"` as **foreground parallel** calls following the wave structure.

   - For `"parallel"` and `"sequential"` type waves: launch all taskIds as parallel Task calls **in a single message** (do NOT use `run_in_background`). The Task calls block until all builders in the wave return — no polling needed.

   Each builder prompt includes:
   - Plan's **Objective** (from init-phase output), **Solution Approach** (if present), **Decisions** (if present)
   - Full task details inline from the `tasks` map (builders skip TaskGet)
   - Convention sections matched by **file extension** — include ALL sections matching extensions in the task (e.g., `.tsx` → React + TypeScript + style conventions; `.ts` → TypeScript conventions; `.css`/`.scss` → style conventions). Never filter by perceived "relevance" — inclua toda seção cujas extensões aparecem no task.
   - ALL explore-cache sections relevant to this phase (not just task-specific ones). This reduces the need for builders to launch their own Explore agents.
   - `commit with type(scope): description`
   - `CRITICAL: call TaskUpdate with status "completed" as your very last action`

   After all builders in a wave return, verify via `TaskList` that every task is marked completed.

   **On builder failure** (task not marked completed after Task call returned, or no matching commit in `git log`):
   - **First failure (0 retries)**: Use the Task result output to diagnose the issue. Re-launch the task with an additional note describing the previous failure. Increment retry counter.
   - **After 1 retry**: Stop and report the failure. Do not retry further.

4. **Validate phase code (parallel with step 5)**: Launch BOTH of the following in a single message:

   - `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --no-test` via Bash with `run_in_background=true`
   - `bun $CLAUDE_HOME/devorch-scripts/run-validation.ts --plan .devorch/plans/current.md --phase N` via Bash with `run_in_background=true`

   Collect results after both complete. Evaluate combined results:
   - If check-project.ts lint/typecheck fail on files modified in this phase: fix inline with Edit and retry check once.
   - If check-project.ts fails on pre-existing issues: log as warning and proceed.
   - If run-validation.ts fails: log warning and proceed (the final check in build.md will catch issues).
   - If everything passes: proceed.

5. **Phase commit**: Run `git -C <projectRoot> status --porcelain`. If output is empty, skip commit. If output has changes:
   - Run `bun $CLAUDE_HOME/devorch-scripts/format-commit.ts --goal "<goal text from init-phase>" --phase N`
   - Use the `message` field from the JSON output as the git commit message.

6. **Invalidate and update cache**: Run `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000 --root <mainRoot>`

   If new Explore agents were launched during this phase, append their summaries to `<mainRoot>/.devorch/explore-cache.md` before or after running manage-cache.

7. **Update state**: Run `bun $CLAUDE_HOME/devorch-scripts/update-state.ts --plan .devorch/plans/current.md --phase N --status "ready for phase $((N+1))" --summary "<concise phase summary>"`

   This writes state.md with the latest phase summary.

8. **Report**: What was done and any issues encountered.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Execute **ONE phase** per invocation.
- The orchestrator never reads source code files. Use Explore agents for codebase context. Only read devorch files (`.devorch/*`).
- Deploy builders as **foreground parallel** Task calls — never use `run_in_background` for builders.
- If a builder fails, report and stop.
- Always update state.md (step 7), even on partial failure.
