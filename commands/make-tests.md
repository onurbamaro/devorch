---
description: Generate and run tests based on the test plan
model: opus
---

Generate and run tests based on the test plan.

## Steps

1. **Load test plan**: Read `.devorch/plans/tests.md`. If it doesn't exist, tell the user to run `/devorch:plan-tests` first.

2. **Load context**: Read `.devorch/CONVENTIONS.md` for project conventions and test framework info.

3. **Setup** (if needed): Check if test infrastructure is in place:
   - Test framework installed
   - Config files present (vitest.config.ts, jest.config.js, etc.)
   - If missing, set up the basics first

4. **Explore context**: Before creating tasks, launch parallel `Task` agents with `subagent_type=Explore` to understand the implementation code that will be tested (e.g., one per module in the test plan). Include gathered context summaries in each builder's prompt so they understand the code they're testing. **Do NOT read source files directly in the orchestrator.**

5. **Create tasks**: Break the test plan into tasks via TaskCreate. Group by module — each task covers one module's tests.

6. **Deploy builders**: Launch Task agents (devorch-builder pattern) to write tests:
   - Each builder writes tests for one module
   - Follow project conventions for test location and naming
   - Use mocks/fixtures as specified in the test plan

7. **Run tests**: After all builders complete, run the test suite:
   ```
   bun $CLAUDE_HOME/devorch-scripts/check-project.ts
   ```
   Also run tests directly if a test script is available.

8. **Fix failures**: If tests fail:
   - Analyze failures
   - Fix test code (not implementation code — tests should test existing behavior)
   - Re-run until green

9. **Commit**: Auto-commit all test files:
   ```
   test(scope): add unit/integration tests for [modules]
   ```

10. **Report**: Show test results, coverage summary (if available), and any tests that were skipped or need manual attention.

## Rules

- Do not narrate actions. Execute directly without preamble.
- **The orchestrator NEVER reads source code files directly.** Use Explore agents to gather context and pass summaries to builders.
- Tests should test BEHAVIOR, not implementation.
- Never modify implementation code to make tests pass. If implementation has bugs, note them.
- Follow existing test patterns in the project.
- One commit for all test files (not per-module).
