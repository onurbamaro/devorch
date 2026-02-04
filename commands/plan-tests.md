---
description: Plan a testing strategy for the project
model: opus
---

Plan a testing strategy for the project.

## Steps

1. **Load context**: Read `.devorch/PROJECT.md`, `.devorch/CONVENTIONS.md`, and `.devorch/plans/current.md` if they exist.

2. **Assess project**: Run `bun ~/.claude/devorch-scripts/check-project.ts` to understand current project health and existing test infrastructure.

3. **Analyze code**: Launch parallel `Task` agents with `subagent_type=Explore` to investigate the codebase — one per area (e.g., "auth and business logic", "API routes and integrations", "UI components with complex behavior", "utility functions"). **Do NOT read source files directly.** From the Explore summaries, identify:
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

5. **Auto-commit**: Stage and commit the test plan:
   - Stage only `.devorch/plans/tests.md`
   - Format: `chore(devorch): plan tests`

6. **Report**: Show summary of test plan and suggest `/devorch:make-tests` to generate tests.

## Rules

- Do not narrate actions. Execute directly without preamble.
- **The orchestrator NEVER reads source code files directly.** Use `Task` with `subagent_type=Explore` for all code analysis. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results.
- Organize by module/feature, NOT by build phase.
- Prioritize: business logic > API endpoints > UI interactions > utilities.
- Don't over-test. Focus on behavior, not implementation details.
- Consider the existing test framework (from CONVENTIONS.md) — don't introduce new ones.
- This is PLANNING only. Do not write test code.
