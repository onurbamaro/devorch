# Plan: No-Tests Flag for Builder

<description>
Add a `--no-tests` flag to the `/devorch:build` command that propagates through the build pipeline to skip automated test execution at the final verification step (build.md step 3a). The flag passes `--no-test` to `check-project.ts` and updates the final report to show "Tests: ⏭ SKIPPED" instead of test results.
</description>

<objective>
Running `/devorch:build --plan <name> --no-tests` completes the full build pipeline without executing the project's test suite, while lint/typecheck/build checks still run. The final report clearly indicates tests were skipped.
</objective>

<classification>
Type: Enhancement
Complexity: Simple
Risk: Low
</classification>

<decisions>
Scope → Skip tests everywhere (final verification + phase validation). Phases already skip tests by design, so effective change is at final verification.
Interface → `--no-tests` CLI flag on `/devorch:build` command. Follows existing `--no-<feature>` Unix pattern.
Report → Show "Tests: ⏭ SKIPPED" in final report when flag is active.
</decisions>

<relevant-files>
- `commands/build.md` — build orchestrator that launches final verification with check-project.ts (line ~77) and generates the final report (line ~121)
- `scripts/check-project.ts` — already supports `--no-test` flag, no changes needed

<new-files>
(none)
</new-files>
</relevant-files>

<phase1 name="Add --no-tests flag to build pipeline">
<goal>Modify build.md to accept --no-tests flag and propagate it to check-project.ts at final verification, updating the report template accordingly.</goal>

<tasks>
#### 1. Add --no-tests flag to build.md
- **ID**: add-no-tests-flag
- **Assigned To**: builder-1
- Read `commands/build.md` fully
- In the Input section (near `$ARGUMENTS` handling), add `--no-tests` as an optional boolean flag. Parse it early alongside `--plan` and store as a variable (e.g., `noTests = true/false`)
- In step 3a (final verification), where `check-project.ts` is invoked via Bash (the call WITHOUT `--no-test`), conditionally append `--no-test` to the command when `noTests` is true
- Update the final report template in step 3d: when tests result is "skip", render `Tests: ⏭ SKIPPED` instead of the ✅/❌ line
- Ensure the retry loop in step 3c does not classify skipped tests as failures to fix
- Update the `argument-hint` in frontmatter if it exists, to mention `--no-tests`

#### 2. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify `build.md` parses `--no-tests` from `$ARGUMENTS`
- Verify `check-project.ts` invocation includes `--no-test` when flag is set
- Verify report template handles "skip" test result with ⏭ SKIPPED
- Verify default behavior unchanged — without `--no-tests`, tests still run
</tasks>

<execution>
**Wave 1**: add-no-tests-flag
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] `build.md` accepts `--no-tests` flag alongside existing `--plan` flag
- [ ] Final verification call to `check-project.ts` includes `--no-test` when `--no-tests` is passed
- [ ] Final report shows "Tests: ⏭ SKIPPED" when tests are skipped
- [ ] Default behavior unchanged — without `--no-tests`, tests run as before
</criteria>

<validation>
- `bun /home/bruno/.claude/devorch-scripts/validate-plan.ts --plan .devorch/plans/current.md` — validates plan structure
</validation>
</phase1>
