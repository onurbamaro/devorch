---
description: "Fix/debug pontual com investigação Agent Teams"
argument-hint: "<descrição do bug ou tarefa pontual>"
model: opus
---

Targeted fix/debug with Agent Teams investigation. Classifies the task, investigates with parallel agents, executes the fix directly, and verifies in parallel.

**Input**: $ARGUMENTS (bug description or targeted task). If empty, stop and ask the user.

## Steps

### 1. Load context

Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` (inline, without `--persist`) to collect tech stack. Read `.devorch/CONVENTIONS.md` if it exists.

### 2. Classify

Evaluate the task and classify:

**FIX** (contained scope): implementable without needing phases. Examples:
- Rename a type used across multiple files (mechanical, even if it touches 10 files)
- Fix a bug with a clear root cause
- Add missing validation
- Adjust behavior per spec
- Any change where the "how" is obvious and there are no design decisions

**TALK** (needs a plan): requires design decisions, multiple possible approaches, or structural impact. Examples:
- New feature with multiple components
- Refactor that changes the architecture
- Change that affects public APIs in a non-trivial way

If **TALK**: generate a complete prompt for /devorch:talk with all context from the investigation so far. Format:
```
Classificado como tarefa de planejamento.

/devorch:talk <detailed prompt including: what was requested, what the investigation discovered, affected areas, necessary decisions>
```
Stop execution.

If **FIX**: continue.

### 3. Investigate with Agent Teams

Launch 2-3 parallel Explore agents (Task with `subagent_type="Explore"`), each with a distinct focus:

- If bug: each agent tests a different hypothesis about the root cause. Hypotheses must be specific and falsifiable.
  - Example: "Hypothesis: the race condition occurs because `fetchUser()` doesn't await the cache invalidation in `auth-service.ts:45`"
  - Example: "Hypothesis: the null reference is caused by the optional chain missing on `user.profile.settings` in `dashboard.tsx:112`"
  - NOT: "Something might be wrong with the auth module"

- If task: each agent explores a different aspect (affected code, existing patterns, existing tests)

Collect findings from all agents.

### 4. Clarify (conditional)

If ambiguous after investigation: 1-2 quick rounds of `AskUserQuestion`. Maximum 2 rounds — fix should be fast.

### 5. Execute fix

Implement the fix directly using Edit/Write tools. Do NOT spawn builder agents — fix is small and the overhead is not justified. Follow CONVENTIONS.md.

### 6. Verify (all parallel, single message)

Launch everything in parallel in a single message:

- `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` — Bash with `run_in_background=true` (full, with tests)
- 1-2 review agents (conditional — launch if: security area, shared code, or complex logic) — Task with `subagent_type="Explore"`, foreground, parallel. Each review agent receives: modified files (git diff), fix description, CONVENTIONS.md. Focus: did the fix introduce regressions? Untreated edge cases? Pattern violations?

Collect all results after they complete.

### 7. Auto-fix

For each finding from the review agents:
- If trivial fix (missing import, obvious edge case, lint issue): fix directly with Edit, without asking
- If complex: report to the user with context and suggestion

Re-run check-project.ts if auto-fixes were applied.

### 8. Commit

Conventional commit:
- Format: `feat|fix|refactor|chore(scope): description`
- Stage only the files you changed (not `git add .`)

### 9. Report

Concise summary: what changed, commit hash, check results.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Fix.md CAN read and edit source code directly (unlike talk/build which delegate).
- Maximum parallelism in verification.
- If check-project.ts fails and the fix is obvious: fix and re-run.
- If check-project.ts fails and the fix is not obvious: report to the user.
- All user-facing text in Portuguese must use correct pt-BR accentuation and grammar.
