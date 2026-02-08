---
description: Generate and run tests based on the test plan
model: opus
---

Generate and run tests based on the test plan.

**Continues from last checkpoint.** Picks up from where the last session left off via `state.md`.

## Workflow

### 1. Determine scope

- Read `.devorch/plans/tests.md`. If it doesn't exist, tell the user to run `/devorch:plan-tests` first and stop.
- Read `.devorch/state.md` (if exists):
  - Check `Plan:` field is `tests`. If mismatch → stale state from another plan → start fresh.
  - If match → read `Last completed stage:` → resume from the next stage.
  - If no state file → start fresh.
- Count `<module` tags in the test plan → total modules.
- Report: "Building tests for N modules"

### 2. Setup stage (conditional)

Read the `<setup>` section of the test plan. If no setup is needed (section empty or missing), skip to stage 3.

Deploy a `Task` agent with `subagent_type=devorch-builder`. The prompt includes:
- Setup tasks from the test plan
- Project conventions from `.devorch/CONVENTIONS.md`
- `commit with chore(test): setup test infrastructure`
- `CRITICAL: call TaskUpdate with status "completed" as your very last action`

After completion, verify setup is in place. Update state:

```markdown
# devorch State
- Plan: tests
- Last completed stage: setup
- Status: ready for module builders
```

### 3. Module builders

Deploy a `Task` agent with `subagent_type=general-purpose`. The prompt includes:

**Context to pass:**
- Full `<module>` sections from the test plan
- `<objective>`, `<strategy>` and `<fixtures>` sections
- Conventions from `.devorch/CONVENTIONS.md` (filtered: only test-relevant sections per builder)
- Explore cache summaries from `.devorch/explore-cache.md` (filtered per module)

**Instructions for the Task agent:**

1. **Explore (conditional)**: Check explore cache for areas relevant to each module's `<files>`. Launch Explore agents (`Task` with `subagent_type=Explore`) only for uncovered or stale areas. Append new summaries to `.devorch/explore-cache.md`.

2. **Create tasks**: One `TaskCreate` per module. All modules are independent → one wave (no `addBlockedBy`). If more than 5 modules, batch into waves of 5.

3. **Deploy builders**: Launch `Task` agents with `subagent_type=devorch-builder` and `run_in_background=true`. All tasks in a wave launch in a single message.

   Each builder prompt includes:
   - Plan's **Objective** (from `<objective>`)
   - Full module spec inline (builders skip TaskGet)
   - Strategy and fixtures from the test plan
   - Filtered conventions and Explore context
   - `Tests should test BEHAVIOR, not implementation. Never modify implementation code.`
   - `commit with test(module-name): add unit/integration tests`
   - `CRITICAL: call TaskUpdate with status "completed" as your very last action`

   Do NOT include check-project.ts instructions — the builder agent definition already handles validation.

4. **Poll**: Use `TaskList` until all tasks in a wave complete. **Never call `TaskOutput`.**

5. **On builder failure**: Read the builder's output file to diagnose. Re-launch once with diagnostic context. After 1 retry, stop and report failure.

6. **Update cache**: Run `git diff --name-only HEAD~1..HEAD` for changed files. Invalidate stale cache sections. Append new Explore summaries. Trim if over 3000 lines.

After the Task agent returns, verify: check `git log` for test commits matching each module. Update state:

```markdown
# devorch State
- Plan: tests
- Last completed stage: modules
- Modules completed: [list]
- Status: ready for validation
```

### 4. Test validation

Deploy a `Task` agent with `subagent_type=general-purpose`. The prompt includes:

1. Run the full test suite: `bun $CLAUDE_HOME/devorch-scripts/check-project.ts`
2. Also run tests directly if a test script is available.
3. If tests fail:
   - Analyze failures
   - Fix **test code only** — never modify implementation code
   - If implementation has bugs, note them but do not fix
   - Re-run until green or after 3 fix attempts, whichever comes first
4. Commit fixes (if any): `fix(test): correct failing tests`
5. Report: pass/fail per module, any implementation bugs found

After the Task agent returns, verify: run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` to confirm all tests pass. Update state:

```markdown
# devorch State
- Plan: tests
- Last completed stage: validation
- Modules completed: [list]
- Status: complete
```

### 5. Report

Show: modules tested, test counts, pass/fail status, any noted implementation bugs, any tests that need manual attention.

## Rules

- Do not narrate actions. Execute directly without preamble.
- **Context discipline**: build-tests is a thin supervisor. It does NOT launch builders, poll tasks, or fix failures directly. All of that is delegated to per-stage Task agents.
- The orchestrator only reads `.devorch/state.md` and `.devorch/plans/tests.md` between stages. Everything else is inside the per-stage agents.
- Stages run sequentially — each in its own Task agent with clean context.
- Stop on first stage failure. Report which stage failed.
- Tests should test BEHAVIOR, not implementation.
- Never modify implementation code to make tests pass. If implementation has bugs, note them.
- Follow existing test patterns in the project.
