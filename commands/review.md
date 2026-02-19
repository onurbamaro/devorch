---
description: Multi-perspective code review using an Agent Teams adversarial approach
argument-hint: <file, directory, or scope to review — empty for recent changes>
model: opus
---

Spawn a team of specialist reviewers to analyze code from independent perspectives: security, quality, performance, and test coverage. The lead reconciles findings into a unified review report.

Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

**Input**: $ARGUMENTS (file path, directory, PR reference, or empty for recent changes).

## Workflow

### 1. Gate on feature flag

Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` and parse the JSON output.

If `enabled` is `false`, stop and display the `instructions` field to the user. Do not proceed.

### 2. Load context

Use the `templates` field from the check-agent-teams.ts JSON output (parsed in step 1) to get the `review` configuration via `templates["review"]`. If missing or unparseable, use defaults: 4 reviewers (security, quality, performance, tests), model opus.

Read `.devorch/CONVENTIONS.md` if it exists — pass to the quality reviewer for convention compliance checking.

### 3. Determine review scope

If `$ARGUMENTS` is provided:
- File path: review that file and its direct dependencies
- Directory: review all files in that directory
- PR reference or branch: use `git diff` to identify changed files

If `$ARGUMENTS` is empty:
- Run `git diff --name-only HEAD~1..HEAD` to get files from the most recent commit
- If no changes, stop and tell the user: "No recent changes found. Specify a file, directory, or scope to review."

Collect the full list of files in scope. For each file, capture its content path for reviewer access.

### 4. Spawn the review team

Use `TeammateTool` with operation `spawnTeam` to create the team. Configuration from template:
- Team size matches template role count
- Each teammate gets a role name and focus from the template
- All teammates use in-process mode

Assign each reviewer a task via `TaskCreate`. The task description includes:
- Their review lens (from template role focus)
- The full list of files in scope
- Specific instructions per role:
  - **Security**: injection risks, auth/authz gaps, data exposure, unsafe deserialization, dependency vulnerabilities
  - **Quality**: naming conventions, code duplication, complexity, error handling, adherence to CONVENTIONS.md
  - **Performance**: algorithmic complexity, unnecessary allocations, N+1 patterns, blocking operations, resource leaks
  - **Tests**: coverage gaps, missing edge cases, assertion quality, test isolation, flaky patterns

### 5. Coordinate review

As the lead agent:
- Monitor reviewer progress via task status and incoming messages
- If one reviewer finds something that affects another lens (e.g., a security issue that also has quality implications), use `write` to share the cross-cutting finding
- Collect all findings as reviewers complete their tasks

### 6. Synthesize findings

After all reviewers complete:

Write `.devorch/review-report.md`:

```markdown
# Review Report: <scope description>
Generated: <ISO timestamp>

## Scope
<files reviewed, how scope was determined>

## Security Review
**Reviewer**: security
**Severity**: <Critical / High / Medium / Low / Clean>
### Findings
- <finding with file:line reference and severity>
...

## Quality Review
**Reviewer**: quality
**Severity**: <Critical / High / Medium / Low / Clean>
### Findings
- <finding with file:line reference and severity>
...

## Performance Review
**Reviewer**: performance
**Severity**: <Critical / High / Medium / Low / Clean>
### Findings
- <finding with file:line reference and severity>
...

## Test Coverage Review
**Reviewer**: tests
**Severity**: <Critical / High / Medium / Low / Clean>
### Findings
- <finding with file:line reference and severity>
...

## Cross-Cutting Concerns
<issues that span multiple review lenses>

## Unified Recommendations
<prioritized list of actionable fixes, highest severity first>

## Verdict: <PASS / PASS WITH WARNINGS / NEEDS CHANGES>
```

### 7. Commit and report

Stage and commit the report:
- `git add .devorch/review-report.md`
- Commit: `chore(devorch): review report — <scope summary>`

Report to the user with:
- Verdict and overall severity
- Top findings (highest severity first)
- Actionable recommendations with file:line references

## Rules

- Do not narrate actions. Execute directly without preamble.
- Always gate behind the feature flag via `check-agent-teams.ts`. Never skip the gate.
- Use in-process mode exclusively. No tmux or iTerm2 detection.
- Reviewers are strictly READ-ONLY. They analyze and report — they never modify code.
- Every finding must include file:line evidence and a severity level.
- Reviewers must be adversarial — look for problems, not confirmations that code is correct.
- If a reviewer finds no issues in their lens, they report "Clean" — not a fabricated issue.
- Cross-cutting concerns must be identified where one finding affects multiple lenses.
