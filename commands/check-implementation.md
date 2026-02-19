---
description: Verifies the full plan was implemented correctly
model: opus
---

Post-build verification. Only checks what per-phase validators DON'T cover: file artifacts, cross-phase integration, final project health, and adversarial review. Resolves trivial issues automatically, asks for clarification on ambiguous ones, and suggests `/devorch` for complex ones.

Can be run:
- Automatically at the end of `/devorch:build` (inline, not as Task)
- Manually at any time after one or more phases are built

## Workflow

### 1. Load plan data

Run `bun $CLAUDE_HOME/devorch-scripts/extract-criteria.ts --plan <planPath>` to get all acceptance criteria, validation commands, and relevant files as structured JSON. The `<planPath>` variable is set by build.md Step 0 (e.g., `.devorch/plans/current.md` or `.worktrees/<name>/.devorch/plans/current.md`).

Read `<projectRoot>/.devorch/CONVENTIONS.md` (if exists).

Read `<projectRoot>/.devorch/state.md` to determine which phases have been completed.

### 2. Determine changed files

Run `git -C <projectRoot> diff --name-only` against the baseline. To find the baseline:
- If state.md shows all phases complete, diff against the commit before the first phase: scan `git -C <projectRoot> log --oneline` for the first `phase(1):` commit and use its parent.
- If partially complete, diff up to the last completed phase.
- Fallback: diff against the plan commit (`chore(devorch): plan`).

All git commands use `git -C <projectRoot>` to ensure correct working directory when running inside a worktree.

### 3. Verify (all parallel, single message)

Launch **everything** below in a single parallel batch.

**Automated checks (Bash, background)**

Launch via `Bash` with `run_in_background=true`:
- `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` — final lint, typecheck, build, test run.
- `bun $CLAUDE_HOME/devorch-scripts/verify-build.ts --plan <planPath>` — new-file artifact verification.

**Criteria tally (Bash, background)**

- `bun $CLAUDE_HOME/devorch-scripts/extract-criteria.ts --plan <planPath> --tally` — deterministic X/Y score from plan + state. No agent needed — completed phases have all criteria passed (guaranteed by per-phase validator gate).

**Cross-phase integration (one Explore agent, foreground)**

Launch ONE Explore agent via **Task tool call** with `subagent_type="Explore"` (do NOT use `run_in_background`). This is a foreground blocking call.

Prompt includes: the list of changed files from step 2, the new-files list, the phase goals and handoff sections from each completed phase, and CONVENTIONS.md content. Also include: "Read non-invalidated sections from `<mainRoot>/.devorch/explore-cache.md` for structural context of unchanged areas."

Task: Verify that work from different phases integrates correctly:
- Imports between new modules resolve correctly
- No orphan exports (exported but never imported)
- No leftover `TODO`, `FIXME`, `HACK`, or `XXX` comments from builders
- Type consistency across module boundaries (no `any` bridges)
- No dead code introduced (unused functions, unreachable branches)
- Handoff contracts honored (what phase N promised, phase N+1 consumed)

Report each finding with file:line evidence.

**All checks launch in a single message.** The Bash calls run in background; the Explore agent blocks. After the Explore agent returns, collect background Bash results.

### 4. Adversarial review (conditional)

1. Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` and parse the JSON output.
2. If Agent Teams is NOT enabled (`enabled: false`): skip this step entirely. Proceed to step 5.
3. If Agent Teams IS enabled:
   - Use the `templates` field from the check-agent-teams.ts JSON output to get the check-team configuration. If `templates["check"]` is missing or unparseable, use defaults: 3 reviewers, model opus.
   - Create a team using `TeamCreate` with 3 adversarial reviewers from the template:
     - **security**: Adversarial security review — probe for vulnerabilities, injection risks, auth issues, data exposure
     - **quality**: Adversarial quality review — probe for correctness issues, edge case handling, maintainability concerns
     - **performance**: Adversarial performance review — probe for bottlenecks, resource leaks, scalability concerns
   - Provide each reviewer with the combined output from the Explore agent and automated checks from step 3
   - Each reviewer does a deeper adversarial analysis through their lens — actively trying to find flaws
   - Collect adversarial findings for inclusion in the report (step 5)
   - Shut down the team after all reviewers report back

### 5. Report

Compile results from all checks into a structured report:

```
## Implementation Check: <plan name>

### Criteria Tally
Phase 1 — <name>: X/Y ✅
Phase 2 — <name>: X/Y ✅
Phase 3 — <name>: X/Y ✅
Overall: XX/YY criteria passed

### Cross-phase Integration
✅ All imports resolve
✅ No orphan exports
⚠️ 2 TODO comments remaining in src/utils.ts
✅ Type consistency OK

### Automated Checks
Lint: ✅
Typecheck: ✅
Build: ✅
Tests: ✅ (47/47)

### File Artifacts
X/Y new files verified (verify-build.ts output)

### Adversarial Review (if agent teams enabled)
Security: <findings or clean>
Quality: <findings or clean>
Performance: <findings or clean>

### Verdict: PASS / FAIL (with N warnings)
```

Parse the extract-criteria.ts --tally output for the criteria section. Parse verify-build.ts JSON for the file artifacts section. Parse check-project.ts JSON for automated checks. Use Explore agent output for cross-phase integration.

### 6. Smart Dispatch

If **PASS** with no warnings: Report success. (State update is handled by the caller — build.md or the user.)

If **FAIL** or warnings: classify each issue found (from cross-phase integration, automated checks, file artifacts, adversarial review) using the rules below.

**Issue Classification** (evaluate each issue against these rules, in order):

1. **Trivial** — fix is self-evident, single-file, no ambiguity:
   - Leftover `TODO`, `FIXME`, `HACK`, `XXX` comments from builders
   - Unused imports or orphan exports
   - Missing semicolons, trailing whitespace, formatting issues
   - Obvious typos in strings or variable names
   - Empty catch blocks or stub implementations that should have been filled
   - A file that should exist but is missing from a simple copy/rename oversight

2. **Ambiguous** — multiple valid interpretations, needs user input:
   - Behavior change that might be intentional or accidental
   - Naming that could follow multiple conventions
   - Code that works but differs from the pattern in CONVENTIONS.md — unclear if deliberate
   - A test that fails but the expected behavior is debatable
   - A handoff contract that was partially honored — unclear which part matters

3. **Complex** — requires architectural thought, multiple files, or new design:
   - Missing feature that was in the plan but not implemented
   - Structural issue affecting 4+ files
   - Performance problem requiring algorithmic changes
   - Security vulnerability requiring design-level fix
   - Integration issue between multiple modules

**Dispatch Logic** (execute in this order):

**Step 6a — Fix trivial issues inline:**
- For each trivial issue: edit the file directly using the Edit tool. Keep fixes minimal — only change what's needed.
- After all trivial fixes: stage and commit changed files with message `fix(check): <concise description of fixes>`
- Re-run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` to verify no regressions
- Report: "Fixed N trivial issues inline: [one-line list]"

**Step 6b — Ask about ambiguous issues:**
- For each ambiguous issue (or group of related ones): use `AskUserQuestion` with 2-4 concrete options describing the possible interpretations
- Include file:line evidence and the specific ambiguity in the question
- Based on the user's answer:
  - If the answer makes the fix trivial → fix inline (same as 6a: edit, commit, check-project)
  - If the answer reveals complexity → add to the complex list (Step 6c)
- Report each resolution

**Step 6c — Suggest /devorch for complex issues:**
- Group related complex issues into a single coherent description
- Generate a ready-to-paste command with full context:
  ```
  /devorch <detailed description including: what's wrong, which files are affected, what the expected outcome should be>
  ```
- Do NOT attempt to fix complex issues inline — they need proper planning
- Report: "These issues require planning. Suggested command above."

**Step 6d — Re-verify (after any inline fixes):**
- If any fixes were made in steps 6a or 6b:
  - Re-run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` — verify lint + typecheck pass
  - Re-run `bun $CLAUDE_HOME/devorch-scripts/verify-build.ts --plan <planPath>` — verify artifacts
  - If both pass and no complex issues remain: update verdict to **PASS**
  - If both pass but complex issues exist: update verdict to **PASS with N complex issues noted**
  - If re-verification fails: report the new failures (do not loop — one round of fixes only)

## Rules

- Do not narrate actions. Execute directly without preamble.
- Only verify completed phases — don't fail on phases that haven't been built yet.
- The Explore agent does all code inspection. The orchestrator does NOT read source code files directly.
- Report evidence (file:line) for every finding, not vague descriptions.
- Be strict on cross-phase integration (imports, dead code, handoffs) but pragmatic on minor style issues.
- The criteria tally is deterministic — do not re-verify individual criteria. Per-phase validators already gate each phase. Trust the tally.
