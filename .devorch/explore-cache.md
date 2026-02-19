# Explore Cache
Generated: 2026-02-18T00:00:00Z

## Scripts Architecture
19 TypeScript scripts in scripts/, all self-contained CLI tools with JSON stdout output. No shared library — every script defines its own parseArgs(), extractTagContent(), PhaseBounds parsing, safeReadFile(), and plan-reading boilerplate. Two variants of extractTagContent exist: Variant A (simple regex) in extract-criteria.ts, format-commit.ts, tally-criteria.ts; Variant B (line-start-anchored) in extract-waves.ts, generate-summary.ts, init-phase.ts, run-validation.ts. Variant B is correct (avoids false matches on backtick-quoted tags).

Key scripts and their I/O:
- init-phase.ts: --plan --phase --cache-root → JSON with objective, decisions, solution-approach, phase content, handoff, conventions, filtered explore-cache
- extract-waves.ts: --plan --phase → JSON with waves array and tasks map (DUPLICATE of init-phase parsing)
- extract-criteria.ts: --plan → JSON with per-phase criteria and validation commands
- tally-criteria.ts: --plan → JSON with X/Y pass/fail score (NEAR-DUPLICATE of extract-criteria)
- generate-summary.ts: --plan → writes .devorch/build-summary.md
- format-commit.ts: --plan --phase → JSON with commit message string
- update-state.ts: --plan --phase --status --summary → writes state.md + state-history.md
- run-validation.ts: --plan --phase → JSON with pass/fail per command
- validate-plan.ts: --plan → JSON with result (continue|block) + hash
- check-agent-teams.ts: no args → JSON with enabled boolean + templates object (templates field universally ignored by callers)
- manage-cache.ts: --action --max-lines --root → invalidates/trims explore-cache.md
- map-project.ts: positional arg → markdown project map (never persisted)
- setup-worktree.ts: --name → JSON with worktreePath, branch, devorch boolean
- check-project.ts: positional + --timeout → JSON with check results
- list-worktrees.ts: no args → JSON array of worktrees
- hash-plan.ts: --plan → JSON with hash + match boolean
- archive-plan.ts: --plan → JSON with archived path
- map-conventions.ts: positional → generates CONVENTIONS.md content

## Install Pipeline
install.ts copies 5 directories: commands/ → ~/.claude/commands/devorch/, agents/ → ~/.claude/agents/, scripts/ → ~/.claude/devorch-scripts/, templates/ → ~/.claude/devorch-templates/, hooks/ → ~/.claude/hooks/. Each destination is wiped before copy. .md files get $CLAUDE_HOME replaced with actual home path. Also updates ~/.claude/settings.json for statusLine hook. Final message references "/devorch:make-plan". uninstall.ts removes commands/devorch/, agents/devorch-*, devorch-scripts/, and cleans statusLine. Does NOT remove devorch-templates/ (likely oversight).

## Commands Architecture
7 command .md files in commands/:
- make-plan.md: Opus model. 12-step flow: load context → classify → optional Agent Teams → explore → clarify → deep explore → design → create plan in worktree → validate → reset state → auto-commit → report or auto-build. Never reads source directly (Explore agents only). Creates worktree always. --auto flag spawns build as Task.
- quick.md: Opus model. 5-step flow: load context → binary checklist (5 items, ALL YES required) → implement → check-project → auto-commit. No questions ever. Redirects to make-plan on ANY NO.
- build.md: Opus model. Thin supervisor. Resolves plan path → phase loop (reads build-phase.md template, spawns Task per phase) → check-implementation inline → generate-summary → merge offer.
- check-implementation.md: Runs inline in build.md context. extract-criteria → git diff → parallel checks (check-project, verify-build, validation commands, tally-criteria, Explore agent) → optional adversarial review (Agent Teams) → 3-tier smart dispatch → report.
- explore-deep.md: Agent Teams required. 4-agent team (3 explorers + synthesizer). Read-only.
- review.md: Agent Teams required. 4-specialist team (security, quality, performance, tests). Read-only. Adversarial.
- debug.md: Agent Teams required. 4 investigators. Hypothesis-testing.

## Build Phase Template
templates/build-phase.md: 10-step per-phase workflow. Step 1: init-phase.ts. Step 2: explore (check cache, launch agents if needed). Step 3: extract-waves.ts. Step 4: deploy builders (devorch-builder agents). Step 5: run-validation.ts. Step 6: deploy validator (devorch-validator agent, read-only). Step 7: format-commit.ts (phase commit). Step 8: manage-cache.ts. Step 9: update-state.ts. Step 10: report. Phase commit at step 7 almost always empty since validators are read-only.

## Duplication Summary
~609 lines duplicated across 3170 total:
- parseArgs(): 14 scripts, ~130 lines
- extractTagContent(): 7 scripts, 2 incompatible variants
- PhaseBounds parsing loop: 8 scripts, ~220 lines
- safeReadFile(): 3 scripts
- Plan file read boilerplate: 11 scripts, ~55 lines
- Plan title extraction: 5 scripts
- tally-criteria.ts: near-complete duplicate of extract-criteria.ts
- extract-waves.ts: re-parses what init-phase.ts already parsed in same context

## Waste Patterns
- Plan file re-parsed 5-6x per phase (init-phase, extract-waves, run-validation, format-commit, update-state)
- check-agent-teams.ts templates output ignored by all 5 callers who re-read team-templates.md
- Validation commands run N+1 times (per-phase + check-implementation re-runs all)
- Explore cache not passed to check-implementation Explore agent
- map-project output never persisted, unavailable to builders
- state-history.md write-only (no consumer)
- Phase commit almost always empty (validators read-only)
- build-summary.md pollutes project git history
- Cache trim FIFO without phase awareness

## Reference Map for Renaming
make-plan references: install.ts:112, build.md:28, check-implementation.md:6/167/171, quick.md:26/30/32, README.md (multiple), team-templates.md:32
quick references: README.md (3 locations)
extract-waves.ts references: build-phase.md:17/21
tally-criteria.ts references: check-implementation.md:44/119
generate-summary.ts references: build.md:74
state-history.md references: make-plan.md:198, build-phase.md:60, build.md:36, README.md (3 locations), CONVENTIONS.md:102
