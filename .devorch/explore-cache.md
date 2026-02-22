# Explore Cache
Generated: 2026-02-22T00:00:00Z

## Builder Test Flow Architecture

Tests run in **two places** in the devorch build pipeline:

1. **Phase validation** (`build-phase.md` step 4): Already uses `--no-test` — tests are skipped during individual phases by design
2. **Final verification** (`build.md` step 3a): Runs `check-project.ts` WITHOUT `--no-test` — full test suite executes here

The chain: `build.md` step 3a → `check-project.ts` (no `--no-test`) → detects test script in package.json → runs it with 120s timeout → result feeds into retry loop and final report.

`check-project.ts` already has `--no-test` flag support. The infrastructure to skip tests exists at the script level.

## Flag/Args Pattern Analysis

- Central arg parser: `scripts/lib/args.ts` with `parseArgs<T>(defs: FlagDef[])`
- Boolean negation pattern: `--no-<feature>` already established (e.g., `--no-test` in check-project.ts)
- Commands receive input via `$ARGUMENTS` in their `.md` files
- Flags flow: command.md → scripts (CLI flags) → agents (inline prompt context)
- Builders don't receive CLI flags — all context is embedded in their prompt

## Impact Assessment

**Files that need changes to support a build-level --no-tests flag:**

| File | Change |
|------|--------|
| `commands/build.md` | Accept `--no-tests` arg, pass to check-project.ts in step 3a (line ~77), update report template |
| `templates/build-phase.md` | Optionally propagate flag to phase validation (currently already --no-test) |

**What does NOT need to change:**
- `check-project.ts` — already supports `--no-test`
- `args.ts` — already supports boolean flags
- `run-validation.ts` — handles custom validation, not test suite
- `agents/devorch-builder.md` — builders don't run tests directly

**Key risk:** Skipping tests at final verification means no automated verification of cross-phase integration. The retry loop (build.md step 3c) won't catch test failures.

## Existing Patterns

- `build-phase.md` line 44: `check-project.ts <projectRoot> --no-test --with-validation --plan ... --phase N`
- `build.md` line 77: `check-project.ts <projectRoot>` (full check WITH tests)
- Report template (build.md ~line 121): `Tests: ✅/❌ (N/M)` — would need to show "SKIPPED" when flag active
