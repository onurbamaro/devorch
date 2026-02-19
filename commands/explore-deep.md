---
description: Deep architectural exploration using an Agent Teams multi-perspective approach
argument-hint: <architectural question or exploration topic>
model: opus
---

Spawn a team of explorers to investigate an architectural question from independent angles. Each explorer maps a distinct aspect of the system, and a synthesizer reconciles their findings into a coherent analysis with recommendations.

Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

**Input**: $ARGUMENTS (architectural question or exploration topic). If empty, stop and ask the user.

## Workflow

### 1. Gate on feature flag

Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` and parse the JSON output.

If `enabled` is `false`, stop and display the `instructions` field to the user. Do not proceed.

### 2. Load context

Use the `templates` field from the check-agent-teams.ts JSON output (parsed in step 1) to get the `explore-deep` configuration via `templates["explore-deep"]`. If missing or unparseable, use defaults: 3 explorers + 1 synthesizer, model opus.

Read `.devorch/CONVENTIONS.md` if it exists — pass relevant patterns to explorers for context.

### 3. Decompose the topic

Break `$ARGUMENTS` into distinct aspects or sub-questions — one per explorer. Each aspect should be:
- Independent enough for parallel investigation
- Specific enough to produce concrete findings
- Complementary so the combined results cover the full question

Examples of decomposition:
- "How does auth work?" -> (1) auth flow and token lifecycle, (2) permission model and access control, (3) integration points and external auth providers
- "Is the DB layer scalable?" -> (1) query patterns and indexing, (2) connection pooling and resource management, (3) data model and migration strategy

### 4. Spawn the exploration team

Use `TeammateTool` with operation `spawnTeam` to create the team. Configuration from template:
- Team size matches template role count
- Each teammate gets a role name and focus from the template
- All teammates use in-process mode

Assign each explorer a task via `TaskCreate`. The task description includes:
- Their specific aspect/sub-question to investigate
- The overall exploration topic for broader context
- Instructions to share interesting cross-cutting discoveries via `write` messages to other teammates
- Conventions context (if available)

The synthesizer gets a task to:
- Monitor incoming messages from explorers
- Track cross-cutting themes and contradictions
- Prepare to reconcile findings after all explorers complete

### 5. Coordinate exploration

As the lead agent:
- Monitor explorer progress via task status and incoming messages
- When an explorer discovers something that connects to another explorer's domain, use `broadcast` to share the finding with the team
- If two explorers reach conflicting conclusions about the same subsystem, use `write` to ask both to investigate the specific disagreement
- Allow natural debate to emerge — do not force consensus

### 6. Synthesize findings

After all explorers complete:

The synthesizer (or lead, if synthesizer is a role rather than separate agent) produces the report.

Write `.devorch/explore-report.md`:

```markdown
# Exploration Report: <topic>
Generated: <ISO timestamp>

## Question
<$ARGUMENTS>

## Aspect 1: <title>
**Explorer**: <role name>
### Findings
- <finding with file:line references>
...
### Key Insight
<most important takeaway from this aspect>

## Aspect 2: <title>
**Explorer**: <role name>
### Findings
- <finding with file:line references>
...
### Key Insight
<most important takeaway from this aspect>

## Aspect 3: <title>
...

## Cross-Cutting Themes
<patterns or insights that emerged across multiple aspects>

## Contradictions and Tensions
<areas where explorers found conflicting evidence or trade-offs>

## Synthesized Analysis
<unified answer to the original question, grounded in explorer evidence>

## Architectural Recommendations
<actionable recommendations, prioritized>

## Open Questions
<things the exploration could not fully resolve>
```

### 7. Commit and report

Stage and commit the report:
- `git add .devorch/explore-report.md`
- Commit: `chore(devorch): explore report — <topic summary>`

Report to the user with:
- Synthesized answer to the original question
- Key insights per aspect
- Architectural recommendations
- Open questions that may need further investigation

## Rules

- Do not narrate actions. Execute directly without preamble.
- Always gate behind the feature flag via `check-agent-teams.ts`. Never skip the gate.
- Use in-process mode exclusively. No tmux or iTerm2 detection.
- All exploration is strictly read-only. Explorers analyze and report — they never modify code.
- Debate emerges naturally through shared findings, not through assigned advocate/critic roles.
- Every finding must include file:line evidence, not vague descriptions.
- Contradictions between explorers are valuable — report them, do not suppress them.
- The synthesizer must reconcile conflicting evidence, not just concatenate findings.
- Open questions are honest outcomes — do not fabricate answers when evidence is insufficient.
