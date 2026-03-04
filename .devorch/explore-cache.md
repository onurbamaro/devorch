# Explore Cache
Generated: 2026-03-04T00:00:00Z

## Validation Flow (--no-test)
- `--no-test` is HARDCODED in `templates/build-phase.md` line 44 — tests always skipped per-phase
- Per-phase validation runs: lint, typecheck, build, phase-specific validation commands
- Tests only run at final check-conformance (3d) unless `--no-tests` flag passed to build.md
- `check-project.ts` supports `--no-test` flag: skips test detection and execution, records `test: "skip"`
- To enable per-phase tests: remove hardcoded `--no-test` from template or make it conditional

## Check-Conformance (3d)
- Runs as `devorch-builder` Task agent (Opus 4.6, foreground)
- Receives ZERO phase context — only projectRoot path and check command
- Agent discovers failures by running check-project.ts, then fix loop (max 3 retries)
- Review agents (3b) get changed files + phase goals + handoffs, but 3d gets nothing
- No mechanism exists to pass phase summaries, changed files, or builder context to 3d
- The agent spends most time investigating what broke (reading source, test files, configs)

## Phase State and Handoffs
- `phase-summary.ts` captures: phase #, goal, status, summary, satellites — NOT test results
- `state.md` keeps only LAST phase summary (no accumulation)
- `init-phase.ts` provides rich context to new phases: handoff, conventions, filtered cache, waves/tasks
- Changed files accumulate via git diff, not via state files
- Review-fixes (3c) fixes explorer/reviewer findings; check-conformance (3d) fixes lint/typecheck/build/test
- Adding test context to phase-summary would be straightforward via existing summary field
