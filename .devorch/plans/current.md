# Plan: Build Performance Optimization for 1M Context Era

<description>
Optimize devorch build pipeline to reduce total build time from ~26-30 min to ~14-18 min by eliminating the phase agent indirection layer, adding per-task context filtering, optimizing the review phase, and updating planning guidance — all leveraging the 1M token context window now available without additional cost.
</description>

<objective>
Total build time for a typical 2-phase plan reduced by ~40-50% while maintaining all quality guarantees (per-phase validation, adversarial review, isolated builders with fresh context).
</objective>

<classification>
Type: refactor
Complexity: complex
Risk: medium
</classification>

<decisions>
- build-phase.md fate → Always inline, keep as docs/build-phase-reference.md for restoration reference
- Source code reads → Orchestrator can read source files only during review phase (step 3), not during phase execution
- Phase consolidation → Guidance in talk.md prompt (no algorithmic logic), rely on LLM judgment
- Per-task filtering → Both cache + conventions filtered per-task in init-phase.ts output
- Fallback mechanism → No fallback to phase agent; 100% inline. Restore from docs reference if ever needed
- Review retry → Add 1 retry for fix-level builders (same pattern as build phases)
</decisions>

<problem-statement>
The devorch build pipeline takes 13-15 minutes per phase (~26-30 min total with review). The main bottlenecks are: (1) the phase agent indirection layer adds a full LLM inference cycle + Task spawn overhead per phase, (2) explore-cache and conventions are filtered per-phase not per-task causing builders to receive excessive context, (3) the review phase runs a redundant post-review check even when zero findings, and (4) check-project validation blocks the next phase instead of overlapping.

With 1M tokens now available per session without cost increase, the orchestrator can absorb phase coordination inline, eliminating a full layer of indirection. Per-task filtering reduces builder context size by ~30%, improving both speed and quality.
</problem-statement>

<solution-approach>
**Approach**: Flatten the build orchestration from 3 layers (orchestrator → phase agent → builders) to 2 layers (orchestrator → builders) by having build.md execute phase logic inline.

**Key changes**:
1. build.md step 2 absorbs build-phase.md logic: calls init-phase.ts, dispatches builders directly, runs check-project with overlap
2. init-phase.ts outputs conventionsByTask and cacheByTask instead of flat content
3. Review phase reads diff files inline (relaxed source-read rule), skips post-review check on zero findings, adds retry for fix-level builders
4. talk.md gets consolidation guidance to prefer fewer, denser phases

**Alternatives considered**:
- Hybrid fallback (inline for small phases, delegate for large): rejected as premature complexity (YAGNI)
- Algorithmic phase consolidation in validate-plan.ts: rejected in favor of prompt guidance (simpler, uses model judgment)
- Full source-read relaxation: rejected to keep orchestrator light during phase execution

**Risks**:
- build.md becomes significantly larger (~400+ lines vs current 276). Mitigated by clear section separation.
- Orchestrator context grows with inline phase execution. Mitigated by 1M window and scripts returning only JSON results.
- Per-task filtering in init-phase.ts adds complexity. Mitigated by keeping it in the same deterministic script.
</solution-approach>

<relevant-files>
- `commands/build.md` — main orchestration file, absorbs phase loop inline + review optimizations
- `templates/build-phase.md` — current phase agent template, to be archived as documentation
- `scripts/init-phase.ts` — context compiler, gets per-task filtering + map-project caching
- `docs/PHILOSOPHY.md` — Principle 1 update for 1M context era
- `commands/talk.md` — planning guidance for phase consolidation
- `scripts/lib/plan-parser.ts` — shared plan parsing utilities used by init-phase.ts

<new-files>
- `docs/build-phase-reference.md` — archived copy of build-phase.md for restoration reference
</new-files>
</relevant-files>

<phase1 name="Inline Phase Execution and Per-Task Context">
<goal>Eliminate the phase agent layer by having build.md execute phase logic inline, and add per-task context filtering to init-phase.ts</goal>

<tasks>
#### 1. Restructure build.md Phase Loop
- **ID**: inline-phase-loop
- **Assigned To**: orchestration-builder
- Rewrite step 2 (Phase loop) in `commands/build.md` to execute phase logic inline instead of delegating to a general-purpose Task agent
- The orchestrator now directly: (a) calls `init-phase.ts` via Bash, (b) launches Explore agents if cache coverage is insufficient, (c) dispatches builders as first-level Task calls following wave structure from init-phase output, (d) runs `check-project.ts` in background (`run_in_background=true`), (e) overlaps by calling `init-phase.ts` for next phase while check runs, (f) calls `phase-summary.ts` and `manage-cache.ts` inline
- Preserve all existing behavior: wave-based parallel dispatch, builder retry (1 retry on failure), satellite repo support, validation commands
- Use the new `conventionsByTask` and `cacheByTask` fields from init-phase output when constructing builder prompts (each builder gets only its task-specific conventions and cache, not the full phase content)
- Remove the `Read $CLAUDE_HOME/devorch-templates/build-phase.md once` instruction since template is no longer used as Task prompt
- Keep effort guidance for builders: "Execute focused implementation. Prioritize writing correct code over exploration."
- Add effort guidance for orchestrator inline: "Coordinate efficiently. Focus on dispatching tasks and monitoring completion."
- Handle the check-project overlap: after dispatching builders and they return, start `check-project.ts` in background AND start `init-phase.ts` for next phase. If check-project fails, stop before dispatching next phase builders. If check passes, next phase is ready immediately.

#### 2. Add Per-Task Filtering to init-phase.ts
- **ID**: per-task-filtering
- **Assigned To**: scripts-builder
- Modify `scripts/init-phase.ts` to add two new fields to JSON output: `conventionsByTask` and `cacheByTask`
- `conventionsByTask`: Parse CONVENTIONS.md into sections by `## ` headers. For each task, extract file extensions from its backtick-quoted paths. Match convention sections that mention those extensions (e.g., `.tsx` matches React, TypeScript, style sections). Output: `{ "task-id": "filtered conventions string" }`
- `cacheByTask`: Apply the existing `filterCache()` logic but scoped to each task's file refs instead of the entire `<tasks>` block. Output: `{ "task-id": "filtered cache string" }`
- Cache `map-project.ts` result: before calling the subprocess, check if `.devorch/project-map.md` exists and was written in the current build (check file mtime vs build start or existence of file). If fresh, read it instead of running subprocess. If not, run subprocess and write result to `.devorch/project-map.md`
- Keep existing per-phase `content`/`contentFile` output for backward compatibility (the phase agent reference doc may be restored)
- Maintain the `CONTENT_THRESHOLD = 50000` logic unchanged

#### 3. Archive build-phase.md and Update Documentation
- **ID**: docs-update
- **Assigned To**: docs-builder
- Copy `templates/build-phase.md` to `docs/build-phase-reference.md` with a header: `<!-- ARCHIVED: This was the phase agent template before inline execution was adopted in the 1M context era. Kept as reference for potential restoration. See commands/build.md step 2 for current implementation. -->`
- Delete `templates/build-phase.md` (the original)
- Update `docs/PHILOSOPHY.md` Principle 1: change "The 1M context window is a safety net, not a strategy" to reflect that the orchestrator can use more context for coordination (not implementation). Keep the core message that focused context beats diluted context. Update the threshold language.
- Update the anti-principle "Just use a bigger context window" to acknowledge that larger context enables reduced orchestration overhead while maintaining that implementation context should stay focused

#### 4. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify `commands/build.md` step 2 contains inline phase logic (no Task delegation for phases)
- Verify `scripts/init-phase.ts` outputs `conventionsByTask` and `cacheByTask` fields
- Verify `templates/build-phase.md` no longer exists
- Verify `docs/build-phase-reference.md` exists with archive header
- Verify `docs/PHILOSOPHY.md` Principle 1 is updated
- Run `bun scripts/init-phase.ts --help` or similar to verify script still runs
</tasks>

<execution>
**Wave 1** (parallel): inline-phase-loop, per-task-filtering, docs-update
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] build.md step 2 executes phase logic inline (no general-purpose Task agent for phases)
- [ ] build.md dispatches builders as first-level Task calls using init-phase output
- [ ] build.md overlaps check-project with next phase init-phase call
- [ ] init-phase.ts JSON output includes conventionsByTask and cacheByTask fields
- [ ] init-phase.ts caches map-project.ts result in .devorch/project-map.md
- [ ] templates/build-phase.md removed, docs/build-phase-reference.md created
- [ ] PHILOSOPHY.md Principle 1 updated for 1M context era
</criteria>

<validation>
- `test -f docs/build-phase-reference.md && echo pass || echo fail` — archived reference exists
- `test ! -f templates/build-phase.md && echo pass || echo fail` — original template removed
- `bun --eval "import './scripts/init-phase.ts'" 2>&1 | head -5` — script syntax valid
</validation>

<test-contract>
- init-phase.ts should produce valid JSON with conventionsByTask and cacheByTask when given a plan with multiple tasks
</test-contract>

<handoff>
build.md step 2 now runs phases inline. Phase agents are eliminated. init-phase.ts returns per-task filtered context. build-phase.md archived as docs reference. Step 3 (review) is unchanged and ready for optimization in Phase 2.
</handoff>
</phase1>

<phase2 name="Review Optimization and Planning Guidance">
<goal>Optimize the review phase for speed and add planning guidance to prefer fewer phases</goal>

<tasks>
#### 1. Optimize build.md Review Phase
- **ID**: review-optimization
- **Assigned To**: review-builder
- Modify `commands/build.md` step 3 (Final verification) with these optimizations:
- **Cross-phase explore inline**: Instead of launching a cross-phase Explore agent (Task call), the orchestrator reads the diff files directly using Read tool and performs the cross-phase verification inline (imports resolve, no orphan exports, no leftover TODO/FIXME, type consistency). This is allowed because the "no source reads" rule is relaxed for step 3 only. Remove the cross-phase Explore agent from step 3b — keep only the 3 adversarial reviewers as parallel Task calls
- **Skip post-review check on zero findings**: If all 3 adversarial reviewers AND the inline cross-phase check report zero findings, skip the post-review `check-project.ts` run entirely. The last phase's check already validated everything.
- **Add 1 retry for fix-level builders**: After fix-level builders complete and post-review check runs, if check fails: diagnose which fix-level builder's changes caused the failure, relaunch that builder with error context (1 retry max). If retry fails, verdict FAIL.
- **Batch trivial fixes**: Group trivial findings by file. Apply all fixes for the same file in a single Edit call sequence instead of interleaving files.
- Add a note in step 3 documenting the relaxed source-read rule: "The orchestrator reads source files directly in this step only (review phase). During phase execution (step 2), source reads remain delegated to builders and Explore agents."

#### 2. Add Phase Consolidation Guidance to talk.md
- **ID**: planning-guidance
- **Assigned To**: planning-builder
- Add guidance in `commands/talk.md` Step 6 (Design solution) to prefer fewer, denser phases
- Add a new subsection or bullet points covering: when to merge adjacent phases (both have ≤3 tasks, no cross-phase file conflicts, no mandatory handoff context needed), when NOT to merge (tasks in phase B depend on phase A outputs, shared file modifications across phases), examples
- Update the Sizing Rules section to strengthen the "prefer fewer phases" guidance: "With 1M context, the orchestrator handles phases inline — each additional phase adds ~2-3 min overhead (init + check + summary). Consolidate when safe."
- Update the Parallelization Rules to note that wider waves within fewer phases is more efficient than narrow waves across many phases
- Do NOT add algorithmic logic to validate-plan.ts — this is prompt guidance only

#### 3. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verify build.md step 3 no longer launches cross-phase Explore agent (only 3 adversarial reviewers)
- Verify build.md step 3 has skip-check-on-zero-findings logic
- Verify build.md step 3 has retry logic for fix-level builders
- Verify talk.md has consolidation guidance in Step 6 and updated Sizing Rules
</tasks>

<execution>
**Wave 1** (parallel): review-optimization, planning-guidance
**Wave 2** (validation): validate-phase-2
</execution>

<criteria>
- [ ] build.md step 3 performs cross-phase verification inline (no Explore agent)
- [ ] build.md step 3 skips post-review check when all reviewers report zero findings
- [ ] build.md step 3 has 1 retry for fix-level builders on post-review check failure
- [ ] build.md step 3 batches trivial fixes by file
- [ ] talk.md Step 6 has phase consolidation guidance
- [ ] talk.md Sizing Rules updated with 1M context overhead note
</criteria>

<validation>
- `grep -c "cross-phase" commands/build.md` — verify cross-phase logic exists but as inline, not as Explore agent launch
- `grep -c "consolidat" commands/talk.md` — verify consolidation guidance added
</validation>
</phase2>
