---
description: Verifies the full plan was implemented correctly
model: opus
---

Comprehensive post-build verification. Checks that every acceptance criterion from every phase is implemented, conventions are followed, and cross-phase integration works.

Can be run:
- Automatically at the end of `/devorch:build-all`
- Manually at any time after one or more phases are built

## Workflow

### 1. Load plan data

Run `bun $CLAUDE_HOME/devorch-scripts/extract-criteria.ts --plan .devorch/plans/current.md` to get all acceptance criteria, validation commands, and relevant files across all phases as structured JSON.

Read `.devorch/CONVENTIONS.md` (if exists).

Read `.devorch/state.md` to determine which phases have been completed. Only verify completed phases.

### 2. Determine changed files

Run `git diff --name-only` against the baseline. To find the baseline:
- If state.md shows all phases complete, diff against the commit before the first phase: scan `git log --oneline` for the first `phase(1):` commit and use its parent.
- If partially complete, diff up to the last completed phase.
- Fallback: diff against the plan commit (`chore(devorch): plan`).

This produces the list of files that were created or modified by the build.

### 3. Verify and check (all parallel)

Launch **everything** in a single parallel batch — Explore agents and automated checks are independent and must not wait for each other.

**Automated checks (background)**

Launch via `Bash` with `run_in_background=true`:
- `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` for lint, typecheck, build, and test.
- Each **Validation Command** from every completed phase (from the extract-criteria output). If multiple commands, chain with `&&`.

**Per-phase functional agents (one per completed phase)**

For each completed phase, launch a separate Explore agent (`Task` with `subagent_type=Explore`). This prevents a single agent from running out of context on large plans.

Each agent's prompt includes: that phase's acceptance criteria (from extract-criteria output), the objective, and the relevant files for that phase.

Task: For each acceptance criterion in the assigned phase, locate the implementation in the codebase and verify it satisfies the criterion. Report each as:
- ✅ **PASS** — criterion fully met, with file:line evidence
- ⚠️ **PARTIAL** — partially met, describe what's missing
- ❌ **FAIL** — not implemented or broken

**Convention compliance agent (one)**

Prompt includes: the list of changed files from step 2, the full CONVENTIONS.md content.

Task: For each changed file, verify it follows the project conventions:
- Naming (files, variables, functions, types)
- Export patterns (named vs default)
- Import style (path aliases, ordering)
- Error handling patterns
- Code style (indentation, semicolons, quotes — if not enforced by linter)
- React/component patterns (if applicable)

Report each file as compliant or list specific violations.

**Cross-phase integration agent (one)**

Prompt includes: the list of new files, the phase goals (`<goal>`) and handoff sections (`<handoff>`), the list of changed files.

Task: Verify that work from different phases integrates correctly:
- Imports between new modules resolve correctly
- No orphan exports (exported but never imported)
- No leftover `TODO`, `FIXME`, `HACK`, or `XXX` comments from builders
- Type consistency across module boundaries (no `any` bridges)
- No dead code introduced (unused functions, unreachable branches)
- Handoff contracts honored (what phase N promised, phase N+1 consumed)

**All Explore agents and background checks launch in a single message.** For a 3-phase plan, this means 5 Explore agents + 1-2 background Bash tasks, all concurrent. Collect all results before proceeding to the report.

### 4. Adversarial review (conditional)

Check if `--team` flag is present in `$ARGUMENTS`.

If `--team` flag is NOT present: skip this step entirely. Proceed to step 5.

If `--team` flag IS present:

1. Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` and parse the JSON output.
2. If Agent Teams is NOT enabled (`enabled: false`): stop and display the `instructions` field to the user. Do not proceed.
3. If Agent Teams IS enabled:
   - Read `.devorch/team-templates.md` and extract the `check-team` template. If missing or unparseable, use defaults: 3 reviewers, model opus.
   - Spawn a team using `TeammateTool` `spawnTeam` with 3 adversarial reviewers from the template:
     - **security**: Adversarial security review — probe for vulnerabilities, injection risks, auth issues, data exposure
     - **quality**: Adversarial quality review — probe for correctness issues, edge case handling, maintainability concerns
     - **performance**: Adversarial performance review — probe for bottlenecks, resource leaks, scalability concerns
   - Provide each reviewer with the combined output from all Explore agents and automated checks from step 3
   - Each reviewer does a deeper adversarial analysis through their lens — actively trying to find flaws
   - Lead collects adversarial findings for inclusion in the report (step 5)

### 5. Report

Compile results from all Explore agents and automated checks into a structured report:

```
## Implementation Check: <plan name>

### Functional Completeness
Phase 1 — <name>: X/Y criteria ✅
Phase 2 — <name>: X/Y criteria ✅
Phase 3 — <name>: X/Y criteria (⚠️ 1 partial)
Overall: XX/YY criteria passed

### Convention Compliance
N files checked — M compliant, K issues:
- `src/foo.ts` — uses default export (project uses named exports)
- `src/bar.ts` — missing error handling in async function

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

### Phase Validation Commands
Phase 1: `cmd1` ✅, `cmd2` ✅
Phase 2: `cmd3` ✅

### Adversarial Review (if --team)
Security: <findings or clean>
Quality: <findings or clean>
Performance: <findings or clean>

### Verdict: PASS / FAIL (with N warnings)
```

### 6. Follow-up

If **PASS**: Update `.devorch/state.md` status to `completed`. Report success.

If **FAIL** or warnings: List each issue as a concrete fix, and suggest:
```
/devorch:quick <specific fix description>
```
for each actionable issue. Group related issues into a single quick fix when they affect the same file.

## Rules

- Do not narrate actions. Execute directly without preamble.
- Only verify completed phases — don't fail on phases that haven't been built yet.
- The orchestrator does NOT read source code files directly. Explore agents do all code inspection.
- Report evidence (file:line) for every finding, not vague descriptions.
- Be strict on functional criteria (the plan says what must work) but pragmatic on conventions (warn, don't fail, for minor style issues that linters don't catch).
