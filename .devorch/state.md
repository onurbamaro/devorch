# devorch State
- Plan: Devorch Unification — Single Command + Waste Elimination
- Last completed phase: 2
- Status: ready for phase 3

## Phase 2 Summary
All 19 scripts refactored to use shared lib (scripts/lib/). extract-waves.ts merged into init-phase.ts (waves+tasks in output). tally-criteria.ts merged into extract-criteria.ts (--tally flag). update-state.ts simplified (no state-history.md). format-commit.ts gains --goal flag. map-project.ts gains --persist flag. extractTagContent fixed for single-line tags. 17 scripts remain, all typecheck passes.
