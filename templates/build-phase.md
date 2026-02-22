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

   **Multi-repo tasks**: When init-phase output includes a `satellites` array (non-empty), check each task's `repo` field:
   - If `repo` == `"primary"` (or absent): builder uses `<projectRoot>` as working directory (default behavior).
   - If `repo` != `"primary"`: find the matching satellite in the `satellites` array by name. Add the following to the builder prompt:
     - `Working directory: <satellite.worktreePath>`
     - `All file operations and git commands must use this directory as root`
     - `Use git -C <satellite.worktreePath> for all git commands`
   - This allows builders to operate in the correct repo without cross-repo awareness.

   After all builders in a wave return, verify via `TaskList` that every task is marked completed.

   **On builder failure** (task not marked completed after Task call returned, or no matching commit in `git log`):
   - **First failure (0 retries)**: Use the Task result output to diagnose the issue. Re-launch the task with an additional note describing the previous failure. Increment retry counter.
   - **After 1 retry**: Stop and report the failure. Do not retry further.

4. **Validate phase code**: Run the following via Bash with `run_in_background=true`:

   ```
   bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --no-test --with-validation --plan .devorch/plans/current.md --phase N
   ```

   Collect results after it completes. The JSON output includes standard fields (`lint`, `typecheck`, `build`, `test`) plus a `validation` field with `{totalCommands, passed, failed, results}`. Evaluate:
   - If lint/typecheck fail: fix ALL errors regardless of origin. If unable to fix after one retry, report the errors and block the phase — do not proceed.
   - If `validation.failed > 0`: log warning and proceed (the final check in build.md will catch issues).
   - If everything passes: proceed.

   **Satellite validation** (when init-phase output includes non-empty `satellites` array): After validating the primary repo, determine which satellites had tasks in this phase by scanning the `tasks` map for entries where `repo` field != `"primary"`. Collect the unique repo names and match them to the `satellites` array by name.

   For each satellite that had tasks in this phase, run:
   ```
   bun $CLAUDE_HOME/devorch-scripts/check-project.ts <satellite.worktreePath> --no-test
   ```
   Note: satellite checks do NOT use `--with-validation` — only lint, typecheck, and build.

   Aggregate results across all satellites:
   - If any satellite check fails, report which satellite failed and the failure details.
   - If satellite lint/typecheck fail: fix ALL errors regardless of origin. If unable to fix after one retry, report the errors and block the phase — do not proceed.

5. **Phase summary and commit**: Generate commit message and update state in one call:

   - Run `bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan .devorch/plans/current.md --phase N --status "ready for phase $((N+1))" --summary "<concise phase summary>"`
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

   Build the satellites status JSON programmatically from the scan results:
   ```
   satellitesStatus = satellites
     .filter(sat => tasks has entries with repo == sat.name)
     .map(sat => ({ name: sat.name, status: hadChanges ? "committed" : "no-changes" }))
   ```
   Pass to phase-summary via `--satellites '<json>'` (e.g., `[{"name":"sat1","status":"committed"}]`).

6. **Invalidate and update cache**: Run `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000 --root <mainRoot>`

   If new Explore agents were launched during this phase, append their summaries to `<mainRoot>/.devorch/explore-cache.md` before or after running manage-cache.

7. **Report**: What was done and any issues encountered. Include satellite validation results (pass/fail per satellite) in the report. If any satellite had check-project failures, list the satellite name and failure details.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Execute **ONE phase** per invocation.
- The orchestrator never reads source code files. Use Explore agents for codebase context. Only read devorch files (`.devorch/*`).
- Deploy builders as **foreground parallel** Task calls — never use `run_in_background` for builders.
- If a builder fails, report and stop.
- Always update state.md (step 5 via phase-summary.ts), even on partial failure.
