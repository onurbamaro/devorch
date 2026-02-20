# Explore Cache
Generated: 2026-02-19T02:20:00Z

## Build Validation Flow

### Per-builder (devorch-builder.md step 4, lines 24-27)
- Runs `check-project.ts` (lint+typecheck+build+test) before EACH task commit
- Red Flags table (lines 41, 45) also references check-project.ts
- Post-edit hook (`post-edit-lint.ts`) runs single-file lint on every Write/Edit — this is cheap and stays

### Per-phase (build-phase.md)
- Step 3 (lines 15-35): Deploy builders wave-by-wave
- Line 28: Explicitly says "Do NOT include check-project.ts instructions — the builder agent definition already handles validation"
- Step 4 (lines 36-40): run-validation.ts runs plan's `<validation>` commands
- Step 5 (lines 42-43): Validator agent checks criteria (read-only, no check-project.ts)
- Steps 6-8: Commit, cache, state update

### End-of-build (check-implementation.md)
- Step 3 parallel checks:
  - check-project.ts (background) — lines 37-38
  - verify-build.ts (background) — line 39
  - Conditional per-phase validation re-run — lines 40-41 (TO REMOVE)
  - extract-criteria.ts --tally — lines 43-44
  - Cross-phase Explore agent — lines 46-61
- Step 4: Adversarial review (conditional, Agent Teams only)
- Step 6: Smart Dispatch — if fixes made, re-runs check-project.ts (lines 121-183)

### Cost Analysis
| Check | Frequency | Cost per run |
|-------|-----------|-------------|
| post-edit lint hook | Every Write/Edit | fast (1-2s) |
| check-project.ts per builder | N times (N tasks) | slow (30-120s) |
| run-validation.ts per phase | 1x per phase | varies |
| Validator agent per phase | 1x per phase | medium (10-60s LLM) |
| check-project.ts end-of-build | 1x | slow (30-120s) |
| verify-build.ts | 1x | fast (1-3s) |
| Conditional re-run | 1x | varies (redundant) |
| Cross-phase Explore | 1x | medium-slow (15-60s) |

## Scripts Architecture
19 TypeScript scripts in scripts/, all self-contained CLI tools with JSON stdout output. Shared utilities in `./lib/` (plan-parser, args, fs-utils).

Key scripts and their I/O:
- init-phase.ts: --plan --phase --cache-root → JSON with objective, decisions, solution-approach, phase content, handoff, conventions, filtered explore-cache
- extract-waves.ts: --plan --phase → JSON with waves array and tasks map
- extract-criteria.ts: --plan → JSON with per-phase criteria and validation commands
- format-commit.ts: --plan --phase → JSON with commit message string
- update-state.ts: --plan --phase --status --summary → writes state.md + state-history.md
- run-validation.ts: --plan --phase → JSON with pass/fail per command
- validate-plan.ts: --plan → JSON with result (continue|block) + hash
- check-project.ts: positional + --timeout → JSON with check results
- manage-cache.ts: --action --max-lines --root → invalidates/trims explore-cache.md
- verify-build.ts: parses `<new-files>` from plan, checks each file exists and isn't a stub
