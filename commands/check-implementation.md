---
description: Verifies the full plan was implemented correctly
model: opus
---

Post-build verification. Only checks what per-phase validators DON'T cover: file artifacts, cross-phase integration, final project health, and adversarial review.

Can be run:
- Automatically at the end of `/devorch:build` (inline, not as Task)
- Manually at any time after one or more phases are built

## Workflow

### 1. Load plan data

Run `bun $CLAUDE_HOME/devorch-scripts/extract-criteria.ts --plan .devorch/plans/current.md` to get all acceptance criteria, validation commands, and relevant files as structured JSON.

Read `.devorch/CONVENTIONS.md` (if exists).

Read `.devorch/state.md` to determine which phases have been completed.

### 2. Determine changed files

Run `git diff --name-only` against the baseline. To find the baseline:
- If state.md shows all phases complete, diff against the commit before the first phase: scan `git log --oneline` for the first `phase(1):` commit and use its parent.
- If partially complete, diff up to the last completed phase.
- Fallback: diff against the plan commit (`chore(devorch): plan`).

### 3. Verify (all parallel, single message)

Launch **everything** below in a single parallel batch.

**Automated checks (Bash, background)**

Launch via `Bash` with `run_in_background=true`:
- `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` — final lint, typecheck, build, test run.
- `bun $CLAUDE_HOME/devorch-scripts/verify-build.ts --plan .devorch/plans/current.md` — new-file artifact verification.
- Each **Validation Command** from every completed phase (from extract-criteria output). If multiple, chain with `&&`.

**Criteria tally (Bash, background)**

- `bun $CLAUDE_HOME/devorch-scripts/tally-criteria.ts --plan .devorch/plans/current.md` — deterministic X/Y score from plan + state. No agent needed — completed phases have all criteria passed (guaranteed by per-phase validator gate).

**Cross-phase integration (one Explore agent, foreground)**

Launch ONE Explore agent via **Task tool call** with `subagent_type="Explore"` (do NOT use `run_in_background`). This is a foreground blocking call.

Prompt includes: the list of changed files from step 2, the new-files list, the phase goals and handoff sections from each completed phase, and CONVENTIONS.md content.

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
   - Read `.devorch/team-templates.md` and extract the `check-team` template. If missing or unparseable, use defaults: 3 reviewers, model opus.
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

### Phase Validation Commands
Phase 1: `cmd1` ✅, `cmd2` ✅
Phase 2: `cmd3` ✅

### Adversarial Review (if agent teams enabled)
Security: <findings or clean>
Quality: <findings or clean>
Performance: <findings or clean>

### Verdict: PASS / FAIL (with N warnings)
```

Parse the tally-criteria.ts output for the criteria section. Parse verify-build.ts JSON for the file artifacts section. Parse check-project.ts JSON for automated checks. Use Explore agent output for cross-phase integration.

### 6. Follow-up

If **PASS**: Report success. (State update is handled by the caller — build.md or the user.)

If **FAIL** or warnings: List each issue as a concrete fix, and suggest:
```
/devorch:quick <specific fix description>
```
for each actionable issue. Group related issues into a single quick fix when they affect the same file.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Only verify completed phases — don't fail on phases that haven't been built yet.
- The Explore agent does all code inspection. The orchestrator does NOT read source code files directly.
- Report evidence (file:line) for every finding, not vague descriptions.
- Be strict on cross-phase integration (imports, dead code, handoffs) but pragmatic on minor style issues.
- The criteria tally is deterministic — do not re-verify individual criteria. Per-phase validators already gate each phase. Trust the tally.
