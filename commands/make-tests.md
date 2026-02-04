Generate and run tests based on the test plan.

## Steps

1. **Load test plan**: Read `.devorch/plans/tests.md`. If it doesn't exist, tell the user to run `/devorch:plan-tests` first.

2. **Load context**: Read `.devorch/PROJECT.md` and `.devorch/CONVENTIONS.md` for project conventions and test framework info.

3. **Setup** (if needed): Check if test infrastructure is in place:
   - Test framework installed
   - Config files present (vitest.config.ts, jest.config.js, etc.)
   - If missing, set up the basics first

4. **Create tasks**: Break the test plan into tasks via TaskCreate. Group by module — each task covers one module's tests.

5. **Deploy builders**: Launch Task agents (devorch-builder pattern) to write tests:
   - Each builder writes tests for one module
   - Follow project conventions for test location and naming
   - Use mocks/fixtures as specified in the test plan

6. **Run tests**: After all builders complete, run the test suite:
   ```
   bun ~/.claude/devorch-scripts/check-project.ts
   ```
   Also run tests directly if a test script is available.

7. **Fix failures**: If tests fail:
   - Analyze failures
   - Fix test code (not implementation code — tests should test existing behavior)
   - Re-run until green

8. **Commit**: Auto-commit all test files:
   ```
   test(scope): add unit/integration tests for [modules]
   ```

9. **Report**: Show test results, coverage summary (if available), and any tests that were skipped or need manual attention.

## Rules

- Tests should test BEHAVIOR, not implementation.
- Never modify implementation code to make tests pass. If implementation has bugs, note them.
- Follow existing test patterns in the project.
- One commit for all test files (not per-module).
