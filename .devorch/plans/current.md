# Plan: Split Final Verification into Review Fixes and Check Conformance

<description>
Restructure the final verification step (section 3) of build.md to separate code review fixes from check conformance fixes. Currently both are mixed in a single classify-and-fix loop (3c), which the model sometimes skips or executes incorrectly due to context exhaustion. The new design runs review fixes first (inline), then delegates check conformance to a dedicated Task agent with clean context and a 3-retry loop.
</description>

<objective>
After this change, build.md section 3 has two distinct stages: (1) code review fixes from explorer/reviewer findings, committed before any check runs, and (2) a dedicated Task agent that runs check-project.ts, fixes lint/typecheck/build/test failures in a loop (max 3 retries), and reports pass/fail. The check-project.ts invocation moves OUT of the parallel 3b launch.
</objective>

<classification>
Type: Enhancement
Complexity: Simple
Risk: Low
</classification>

<decisions>
- Review fixes and check fixes are separate stages -> review first, then check
- Check-project.ts runs AFTER review fixes are committed (runs only once, captures both pre-existing and regression issues)
- Check conformance stage runs as a dedicated Task agent with clean context
- Check fix loop allows 3 retries (up from 2)
- Review fixes remain inline in the orchestrator
</decisions>

<relevant-files>
- `commands/build.md` — the main file being modified (sections 3b, 3c, 3d, report)
- `templates/build-phase.md` — read-only reference for per-phase check behavior (not modified)
- `scripts/check-project.ts` — read-only reference for check-project interface (not modified)

<new-files>
- (none)
</new-files>
</relevant-files>

<phase1 name="Restructure Final Verification">
<goal>Modify build.md sections 3b through 3d to separate review fixes from check conformance, and add the dedicated check agent stage.</goal>

<tasks>
#### 1. Restructure build.md final verification
- **ID**: restructure-final-verification
- **Assigned To**: builder-1
- In `commands/build.md`, modify **section 3b** ("Launch everything parallel"):
  - REMOVE the check-project.ts Bash call (item 1) from the parallel batch. Only launch: cross-phase Explore agent + 3 adversarial review agents.
  - Update the description to say reviewers only — no automated checks here.
  - Remove the sentence "Bash calls run in background; Explore/review agents block as foreground Task calls. After agents return, collect background Bash results." and replace with "All agents block as foreground Task calls."
- Modify **section 3c** ("Synthesize and dispatch"):
  - Rename to "3c. Code review fixes".
  - This section ONLY processes findings from the cross-phase explorer and 3 review agents. Remove all references to check-project.ts results.
  - Keep the classify (trivial/fix-level/talk-level) logic and fix dispatch as-is for review findings.
  - After fixes, commit with prefix `fix(review):` instead of `fix(check):`.
  - REMOVE the "Re-run check-project.ts" retry loop entirely from this section. No recheck here — check runs later.
  - Keep the talk-level escalation to `/devorch:talk`.
- Add new **section 3d** ("Check conformance"):
  - Launch a dedicated Task agent (`subagent_type="devorch-builder"`) as a foreground call.
  - Agent prompt includes: `Working directory: <projectRoot>`, the command to run (`bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot>`, with `--no-test` appended if `noTests` is true), instruction to fix all failures found (lint, typecheck, build, test).
  - Fix loop inside the agent: run check -> if failures -> fix with Edit tool -> commit `fix(check): <description>` -> re-run check -> repeat. Max 3 retry cycles.
  - After 3 retries with remaining failures, the agent returns the failure list to the orchestrator.
  - The orchestrator escalates remaining failures as `/devorch:talk` prompts.
- Renumber existing **section 3d** ("Report") to **3e**.
  - Update the report template to show two separate subsections: "Correções de Review" (from 3c) and "Check Conformance" (from 3d).
  - Show retry count for check conformance (e.g., "passou após 2 retries" or "falhou após 3 retries").

#### 2. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify the modified build.md has correct section numbering (3a, 3b, 3c, 3d, 3e, then 4)
- Verify check-project.ts is NOT referenced in section 3b
- Verify check-project.ts IS referenced in section 3d with the correct command format
- Verify the retry count is 3 in section 3d
- Verify section 3c only references review/explorer findings, no check-project
- Verify section 3e report template has separate subsections for review fixes and check conformance
- Verify `--no-test` flag handling is present in section 3d
</tasks>

<execution>
**Wave 1** (build): restructure-final-verification
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] Section 3b launches only review agents (no check-project.ts)
- [ ] Section 3c handles only review findings, commits with `fix(review):` prefix, no retry loop
- [ ] Section 3d is a dedicated Task agent running check-project.ts with 3-retry fix loop
- [ ] Section 3e report shows both stages separately with retry count
- [ ] Section numbering is consistent (3a through 3e, then 4)
- [ ] `--no-test` flag is properly handled in section 3d
</criteria>

<validation>
- `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan .devorch/plans/current.md` — validates plan structure
</validation>
</phase1>
