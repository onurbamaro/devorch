Plan a testing strategy for the project.

## Steps

1. **Load context**: Read `.devorch/PROJECT.md`, `.devorch/CONVENTIONS.md`, and `.devorch/plans/current.md` if they exist.

2. **Assess project**: Run `bun ~/.claude/devorch-scripts/check-project.ts` to understand current project health and existing test infrastructure.

3. **Analyze code**: Review the implemented code to identify:
   - Critical paths that need testing (auth, data mutations, business logic)
   - Utility functions that benefit from unit tests
   - Integration points (API routes, database queries, external services)
   - UI components with complex behavior

4. **Create test plan**: Write `.devorch/plans/tests.md`:

```markdown
# Test Plan

## Strategy
- Unit tests: [framework, location, naming]
- Integration tests: [approach, setup]
- E2E tests: [framework if needed, key flows]

## Coverage Targets
- Critical paths: [list]
- Nice to have: [list]

## Module: [Module Name]
### Unit Tests
- [ ] [Test description]
- [ ] [Test description]

### Integration Tests
- [ ] [Test description]

## Module: [Module Name]
...

## Fixtures & Mocks
- [What needs mocking and how]

## Setup Required
- [Any test infrastructure to set up first]
```

5. **Report**: Show summary of test plan and suggest `/devorch:make-tests` to generate tests.

## Rules

- Organize by module/feature, NOT by build phase.
- Prioritize: business logic > API endpoints > UI interactions > utilities.
- Don't over-test. Focus on behavior, not implementation details.
- Consider the existing test framework (from CONVENTIONS.md) — don't introduce new ones.
- This is PLANNING only. Do not write test code.
