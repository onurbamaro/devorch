---
description: Investigate bugs using an Agent Teams hypothesis-testing approach
argument-hint: <bug description or investigation target>
model: opus
---

Spawn a team of investigators to debug a problem through parallel hypothesis testing. Each investigator pursues an independent theory, and the lead synthesizes findings into a diagnostic report.

Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

**Input**: $ARGUMENTS (bug description or investigation target). If empty, stop and ask the user.

## Workflow

### 1. Gate on feature flag

Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` and parse the JSON output.

If `enabled` is `false`, stop and display the `instructions` field to the user. Do not proceed.

### 2. Load context

Read `.devorch/team-templates.md` and extract the `debug` template. If missing or unparseable, use defaults: 4 investigators, model opus.

Read `.devorch/CONVENTIONS.md` if it exists — pass relevant sections to investigators as context.

### 3. Explore the affected area

Launch an Explore agent (use the **Task tool call** with `subagent_type="Explore"`) to understand the area described in `$ARGUMENTS`. The Explore agent should:
- Identify relevant files, modules, and data flows
- Note recent changes to the area (`git log --oneline -10 -- <paths>`)
- Surface any existing error handling or known fragile patterns

Use the Explore results to form **initial hypotheses** — one per investigator. Each hypothesis should be a concrete, testable theory about the root cause.

### 4. Spawn the investigation team

Use `TeammateTool` with operation `spawnTeam` to create the team. Configuration from template:
- Team size matches template role count
- Each teammate gets a role name and focus from the template
- All teammates use in-process mode

Assign each teammate a hypothesis via `TaskCreate`. The task description includes:
- The hypothesis to test (specific, falsifiable)
- Relevant files and entry points from the Explore results
- The bug description from `$ARGUMENTS`
- Conventions context (if available)

### 5. Coordinate investigation

As the lead agent:
- Monitor teammate progress via task status and incoming messages
- If an investigator finds strong evidence, use `write` to share the finding with all other investigators so they can corroborate or pivot
- If an investigator is stuck (idle with no findings), use `write` to redirect them toward a new angle
- When an investigator completes their task, read their findings

### 6. Synthesize findings

After all investigators complete (or timeout):

Write `.devorch/debug-report.md`:

```markdown
# Debug Report: <short bug summary>
Generated: <ISO timestamp>

## Bug Description
<$ARGUMENTS>

## Hypotheses Tested
### Hypothesis 1: <title>
- **Investigator**: <role name>
- **Verdict**: Confirmed / Rejected / Inconclusive
- **Evidence**: <file:line references, observed behavior>
- **Details**: <explanation>

### Hypothesis 2: <title>
...

## Root Cause
<synthesized conclusion — which hypothesis was confirmed, or combined findings>

## Recommended Fix
<specific, actionable steps with file:line references>

## Additional Observations
<anything noteworthy discovered during investigation>
```

### 7. Commit and report

Stage and commit the report:
- `git add .devorch/debug-report.md`
- Commit: `chore(devorch): debug report — <short summary>`

Report findings to the user with:
- Root cause (with evidence)
- Recommended fix (with file:line references)
- Any secondary issues discovered

## Rules

- Do not narrate actions. Execute directly without preamble.
- Always gate behind the feature flag via `check-agent-teams.ts`. Never skip the gate.
- Use in-process mode exclusively. No tmux or iTerm2 detection.
- Investigators are read-only analysts — they explore and report, they do not modify code.
- Every finding must include file:line evidence, not vague descriptions.
- If the team cannot determine a root cause, report that honestly with what was ruled out.
- Hypotheses must be specific and falsifiable, not generic ("something is wrong with X").
