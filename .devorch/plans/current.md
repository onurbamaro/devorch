# Plan: Per-Phase Test Execution

<description>
Remove the hardcoded --no-test from build-phase.md so each phase runs tests with full builder context, remove the check-conformance step (3d) from build.md since per-phase validation makes it redundant, and add a quick post-review check to catch regressions from review fixes.
</description>

<objective>
Every build phase runs lint, typecheck, build, AND tests — with the builder fixing failures in-context. The check-conformance step is removed. A single quick check runs after review-fixes as a lightweight safety net.
</objective>

<classification>
Type: Enhancement
Complexity: Medium
Risk: Medium
</classification>

<decisions>
- Tests per phase → Always run tests per phase (remove hardcoded --no-test)
- Check-conformance → Remove step 3d entirely; per-phase validation is sufficient
- Post-review check → Add quick check-project.ts run (no retry loop) after review-fixes (3c)
- Test fix loop → Include test failures in the existing per-phase fix loop alongside lint/typecheck/build
</decisions>

<problem-statement>
The check-conformance step (3d) in build.md takes 41 minutes with only 40 tool uses because: (1) tests are skipped per-phase via hardcoded --no-test, so failures accumulate across phases; (2) the conformance agent starts with zero context about what changed, spending most time investigating rather than fixing. A phase builder that just made the changes could fix test failures in ~1 minute.
</problem-statement>

<solution-approach>
Remove the --no-test flag from the per-phase validation template so builders run tests immediately after their changes, while they still have full context. This eliminates the need for a separate conformance agent. Add tests to the existing fix loop so builders auto-fix test failures. Remove check-conformance (3d) from build.md entirely. Add a lightweight single-run check after review-fixes (3c) to catch regressions introduced by review corrections. Renumber 3e (report) to 3d.

Alternative considered: passing context (changed files + phase summaries) to the conformance agent — rejected because per-phase testing is fundamentally better (builder has full context, fixes in seconds vs minutes).
</solution-approach>

<relevant-files>
- `templates/build-phase.md` — per-phase validation template; line 44 has hardcoded --no-test
- `commands/build.md` — build orchestration; steps 3c (review-fixes), 3d (check-conformance), 3e (report)
- `scripts/check-project.ts` — validation script; handles --no-test flag, test execution with 120s timeout

<new-files>
(none)
</new-files>
</relevant-files>

<phase1 name="Enable Per-Phase Tests">
<goal>Remove hardcoded --no-test from build-phase.md and include tests in the builder fix loop</goal>

<tasks>
#### 1. Remove --no-test and Add Tests to Fix Loop
- **ID**: enable-phase-tests
- **Assigned To**: builder-1
- In `templates/build-phase.md`, remove `--no-test` from the check-project.ts invocation in step 4 (validation)
- In the same file, ensure the fix loop that handles lint/typecheck/build failures also handles test failures
- The fix loop should treat test failures the same as lint/typecheck failures: attempt fix with Edit tool, commit, re-run check
- Verify the check-project.ts command still includes `--with-validation` and phase-specific flags

#### 2. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify `--no-test` no longer appears in templates/build-phase.md validation command
- Verify the fix loop instructions mention test failures alongside lint/typecheck/build
- Verify --with-validation flag is preserved
</tasks>

<execution>
**Wave 1** (single): enable-phase-tests
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] templates/build-phase.md step 4 validation command does NOT include --no-test
- [ ] Fix loop in build-phase.md handles test failures (not just lint/typecheck/build)
- [ ] --with-validation flag preserved in check-project.ts invocation
</criteria>

<validation>
- `grep -c "no-test" templates/build-phase.md` — should return 0
</validation>

<handoff>
build-phase.md now runs tests per-phase. Phase 2 will update build.md to remove check-conformance and add post-review check.
</handoff>
</phase1>

<phase2 name="Restructure Final Verification">
<goal>Remove check-conformance (3d) from build.md, add quick post-review check to 3c, renumber report to 3d</goal>

<tasks>
#### 1. Update Build Orchestration
- **ID**: restructure-verification
- **Assigned To**: builder-1
- In `commands/build.md`, remove the entire check-conformance step (3d) — the dedicated builder agent with retry loop
- In step 3c (review-fixes), after review corrections are applied and committed, add a single inline run of `check-project.ts <projectRoot>` (append `--no-test` only if `noTests` is true). No retry loop, no agent — just run the command and capture results.
- If the post-review check finds failures, report them in the verdict as FAIL with the specific failures listed. Do NOT launch a fix agent.
- Renumber the report step from 3e to 3d
- Update the report format: replace "Check Conformance" subsection with "Post-Review Check" showing pass/fail per check (lint, typecheck, build, test). Remove retry count display since there are no retries.
- Remove any references to check-conformance agent, its retry loop, or the dedicated Task agent launch
- Clean up the `noTests` flag: it now only affects the post-review check in 3c (per-phase tests always run via the template, regardless of this flag)

#### 2. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verify check-conformance step is fully removed from build.md
- Verify post-review check exists in step 3c (single run, no retry)
- Verify report step is now 3d (not 3e)
- Verify no dangling references to check-conformance agent or retry loop
- Verify noTests flag documentation is updated
</tasks>

<execution>
**Wave 1** (single): restructure-verification
**Wave 2** (validation): validate-phase-2
</execution>

<criteria>
- [ ] No check-conformance step (3d with retry loop) exists in build.md
- [ ] Step 3c includes a single check-project.ts run after review fixes
- [ ] Report is now step 3d (renumbered from 3e)
- [ ] Report format includes Post-Review Check section instead of Check Conformance
- [ ] noTests flag only affects post-review check in 3c
- [ ] No orphan references to check-conformance or its builder agent
</criteria>

<validation>
- `grep -ci "check.conformance" commands/build.md` — should return 0
</validation>
</phase2>
