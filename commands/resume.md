---
description: Resume an interrupted devorch build
model: opus
---

Resume a devorch build from where it left off.

## Workflow

### 1. Load state

Read `.devorch/state.md`. If it doesn't exist, stop and tell the user: "No build state found. Start with `/devorch:make-plan` to create a plan, then `/devorch:build` to begin."

Extract:
- `Plan:` field → plan title
- `Last completed phase:` → last completed phase number K

### 2. Validate plan

Read `.devorch/plans/current.md`. Extract the plan title from the first `# Plan: <name>` heading.

If the plan title doesn't match the state's `Plan:` field, stop and tell the user: "State references a different plan. The current plan is '<current title>' but state is from '<state title>'. Run `/devorch:make-plan` to start fresh."

Count phase tags (`<phaseN`) in the plan → total phases.

### 3. Determine next action

- If K >= total phases → all phases complete. Suggest: "All phases are complete. Run `/devorch:check-implementation` to verify the full implementation."
- Otherwise → next phase is K+1. Ask the user:

Use `AskUserQuestion` with:
- Question: "Phase K was the last completed phase (of N total). How would you like to resume?"
- Options:
  1. "Build remaining phases" — Run `/devorch:build` to complete all remaining phases
  2. "Check current state" — Run `/devorch:check-implementation` to verify what's been built so far

### 4. Route

Based on the user's choice, execute the appropriate skill:
- "Build remaining phases" → invoke `/devorch:build`
- "Check current state" → invoke `/devorch:check-implementation`

## Rules

- Do not narrate actions. Execute directly without preamble.
- This command is a thin router — it reads state, presents options, and delegates.
