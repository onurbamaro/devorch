# Explore Cache
Generated: 2026-03-18T12:00:00Z

## Build orchestration layers
5 layers: build.md (orchestrator, 276 lines) → build-phase.md Task agent (phase coordinator, 105 lines) → init-phase.ts (context compiler, 371 lines) → devorch-builder.md Task agents (implementation) → scripts (check-project, phase-summary, manage-cache). Phase agent is the main overhead target — adds full LLM inference cycle + Task spawn overhead per phase. Orchestrator already runs review inline (build.md:67). Phase loop is sequential (build.md:57), each phase dispatched as `subagent_type="general-purpose"` Task (build.md:59).

## init-phase.ts context construction
Reads: plan file, conventions, state, explore-cache, map-project.ts output. Filters cache per-PHASE not per-task (lines 106-151) using backtick regex on entire `<tasks>` block. CONTENT_THRESHOLD=50000 (line 14). map-project.ts called via Bun.spawnSync every phase (lines 259-268) — deterministic, ~200-500ms, output doesn't change between phases. Conventions loaded in full (lines 309-314), filtering by extension happens in build-phase.md prompt construction, not in script. Output JSON includes: waves, tasks map, satellites, content/contentFile.

## check-project.ts timing
Checks run in parallel via Promise.all (lines 323-347). Timeouts: lint/typecheck/build=60s, tests=120s, validation=30s per command. Called twice per build: once per phase (build-phase.md:42 with run_in_background=true) and once in post-review (build.md:126). Satellite checks run sequentially after primary (build-phase.md:55-58).

## Phase consolidation in planning
No algorithmic consolidation exists. Phase boundaries determined manually by talk.md orchestrator in Step 6 (Design solution). Sizing rules (talk.md:248-254): max 5 tasks/phase, prefer fewer phases. validate-plan.ts does NOT enforce max task count — only checks structure, sequential numbering, and wave file conflicts. Consolidation logic would go in talk.md Step 6 or new Step 6.5.

## Review phase architecture
4 agents launched in parallel (build.md:76-96): 1 cross-phase Explore + 3 adversarial reviewers. Cross-phase Explore receives: changed files, new-files, phase goals+handoffs, CONVENTIONS.md. Reviewers receive: plan objective+description (NOT source code), CONVENTIONS.md, changed files list — they read code independently. Findings classified: trivial (Edit inline), fix-level (builder Task), talk-level (escalate). Post-review check runs check-project.ts once more (build.md:126). No retry on post-review failure.

## manage-cache.ts and phase-summary.ts
manage-cache: invalidate removes sections mentioning changed files (git diff HEAD~1..HEAD), trim FIFO to max 5000 lines. Called end of each phase (build-phase.md:90). phase-summary: generates commit message "phase(N): <goal truncated 50 chars>", writes state.md. Both are fast (<500ms).
