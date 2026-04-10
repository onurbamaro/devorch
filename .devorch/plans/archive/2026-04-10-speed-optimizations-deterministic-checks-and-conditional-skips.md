# Plan: Speed Optimizations — Deterministic Checks and Conditional Skips

<description>
Optimize the devorch pipeline for speed without sacrificing quality. Replace LLM-driven checks with deterministic TypeScript scripts (conventions staleness), add conditional skip logic (DA auto-skip for simple plans), and reduce unnecessary exploration (fast-path for targeted fixes). Also parallelize internal subprocess calls in init-phase.ts and add cacheCoversPhase heuristic to skip redundant explore agents.
</description>

<objective>
Simple plans (complexity=simple, risk=low, ≤2 tasks) complete 2-4 minutes faster by skipping DA and reducing exploration. Every /devorch:talk invocation saves 5-15s on conventions staleness check. Build phases skip explore agents when cache already covers all relevant files.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: medium
</classification>

<decisions>
- Consolidation of scripts (init-phase + phase-summary + manage-cache) → Discarded (only 27ms savings)
- DA auto-skip criteria → conservative: simple + low + ≤2 tasks + 1 phase + no secondary-repos
- Fast-path implementation → rules in .md commands (not TypeScript scripts)
- Fix fast-path level → skip explore, keep 1 confirmative clarification round
- CONVENTIONS.md hash storage → .devorch/conventions-hash.json (not embedded in CONVENTIONS.md)
- classify-plan.ts → deferred to future plan
- Additional over-engineering fixes (map-project persist, manage-cache final-only, explore reduction) → deferred
- Async error handling in init-phase.ts → Promise.allSettled (not Promise.all) to preserve graceful degradation
- check-conventions-staleness.ts sampling → must use same SAMPLE_DIRS and CODE_EXTS as map-conventions.ts
- Corrupted conventions-hash.json → treat as stale (regenerate)
</decisions>

<problem-statement>
The devorch pipeline has several LLM-driven steps that could be deterministic (conventions staleness check, cache coverage evaluation) and steps that run unconditionally when unnecessary (DA for simple plans, explore for targeted fixes). This adds 3-8 minutes of overhead for simple plans. The per-phase init+check+summary cycle is dominated by tsc in check-project.ts (~14s on large projects), not script spawning overhead (~27ms).
</problem-statement>

<solution-approach>
Four complementary optimizations:
1. New check-conventions-staleness.ts script — hash-based comparison replacing LLM file analysis. Uses SHA-256 of package.json deps + source file samples (same SAMPLE_DIRS/CODE_EXTS as map-conventions.ts). Stores hashes in .devorch/conventions-hash.json.
2. init-phase.ts internal improvements — (a) parallelize map-project.ts + tldr-analyze.ts via Promise.allSettled instead of sequential spawnSync, (b) add cacheCoversPhase boolean to JSON output based on file-ref-to-cache-section matching.
3. talk.md conditional rules — DA auto-skip for simple/low plans, fast-path reducing exploration for specific inputs, convention staleness via script, cacheCoversPhase usage in inline path.
4. fix.md + build.md rules — fix fast-path skipping explore when file:line + action provided, build.md cacheCoversPhase usage.

Alternative considered: TypeScript scripts for all fast-paths (classify-input.ts, classify-plan.ts). User preferred .md rules for fast-paths and deferred classify-plan.ts. Script consolidation was analyzed and found to save only 27ms — not worth the complexity.
</solution-approach>

<relevant-files>
- `scripts/init-phase.ts` — modify for async parallelization of subprocess calls and cacheCoversPhase output field
- `scripts/map-conventions.ts` — reference for SAMPLE_DIRS, CODE_EXTS, collectFiles patterns to reuse in new script
- `scripts/lib/args.ts` — reference for parseArgs pattern used by new script
- `scripts/lib/fs-utils.ts` — reference for safeReadFile utility
- `commands/talk.md` — modify for DA auto-skip, fast-path, conventions staleness script call, cacheCoversPhase in inline path
- `commands/fix.md` — modify for fast-path (skip explore when file:line + action)
- `commands/build.md` — modify for cacheCoversPhase usage in step 2b

<new-files>
- `scripts/check-conventions-staleness.ts` — new deterministic staleness check script
</new-files>
</relevant-files>

<phase1 name="Speed Optimizations">
<goal>Implement all four optimization tracks: conventions staleness script, init-phase improvements, and command file rule changes</goal>

<spec>
<interface name="check-conventions-staleness">
  <input>positional: project directory (default: cwd). --update flag: write new hashes after check</input>
  <output>JSON to stdout: { stale: boolean, reason: "fresh" | "no-hash-file" | "deps-changed" | "source-changed" | "conventions-missing", depsHash: string, sourceHash: string }</output>
  <error case="no-package-json">stderr message + process.exit(1)</error>
  <error case="corrupted-hash-file">treat as stale — return { stale: true, reason: "no-hash-file" }. Do not crash.</error>
  <error case="devorch-dir-missing">with --update: create .devorch/ directory. Without --update: return stale: true</error>
</interface>

<behavior name="staleness-sampling-alignment">
  <precondition>check-conventions-staleness.ts needs to sample source files for hashing</precondition>
  <postcondition>Script uses identical SAMPLE_DIRS array and CODE_EXTS set as map-conventions.ts. Samples max 5 files per dir, max 12 total. Reads first 50 lines of each file. Hash is SHA-256 of concatenated content.</postcondition>
</behavior>

<behavior name="hash-storage-format">
  <precondition>.devorch/conventions-hash.json needs a stable schema</precondition>
  <postcondition>File format: { "depsHash": string, "sourceHash": string, "checkedAt": ISO-8601 string }. When --update is passed, overwrite entire file. When reading, validate all 3 fields exist — if any missing, treat as corrupted (stale).</postcondition>
</behavior>

<interface name="init-phase-cache-coverage">
  <input>existing init-phase.ts args (no new args needed)</input>
  <output>additional JSON fields: { cacheCoversPhase: boolean, uncoveredFiles: string[] }. Always present in output (default: false when no cache).</output>
</interface>

<behavior name="init-phase-async-parallelization">
  <precondition>init-phase.ts runs map-project.ts and tldr-analyze.ts sequentially via Bun.spawnSync</precondition>
  <postcondition>Both run via Bun.spawn + Promise.allSettled in parallel. Each spawn has independent error handling — if one fails, the other's result is still used. Graceful degradation preserved: map-project failure → projectMap stays empty. tldr-analyze failure → tldrByFile stays empty. Output is identical to current behavior.</postcondition>
</behavior>

<behavior name="cache-covers-phase-logic">
  <precondition>init-phase.ts already has filterCache that matches file refs to cache sections</precondition>
  <postcondition>After filterCache runs, compute: extract all file paths from phase relevant-files. For each, check if it appears in at least one filtered cache section. If ALL files appear → cacheCoversPhase: true, uncoveredFiles: []. If any missing → cacheCoversPhase: false, uncoveredFiles: [missing paths]. If no cache exists → cacheCoversPhase: false.</postcondition>
</behavior>

<behavior name="da-auto-skip">
  <precondition>talk.md Step 6b always launches DA Explore agent</precondition>
  <postcondition>DA is skipped when ALL conditions hold: classification.complexity == "simple", classification.risk == "low", totalTasks ≤ 2, totalPhases == 1, no secondary-repos in plan. When skipped: log "DA skipped — simple/low-risk plan" and proceed directly to Step 7. When any condition fails: run DA normally.</postcondition>
</behavior>

<behavior name="talk-fast-path">
  <precondition>talk.md Step 2 always launches 2-3 Explore agents</precondition>
  <postcondition>When input contains: specific file path references, explicit action described (fix, change, update, rename, add, remove), and sufficient context to implement without discovery → reduce Step 2 to 1 Explore agent at "medium" thoroughness (not "very thorough"). Step 3 (Clarify) reduced to 1 confirmative round.</postcondition>
</behavior>

<behavior name="talk-conventions-staleness-script">
  <precondition>talk.md Step 1 uses LLM reasoning to compare CONVENTIONS.md against package.json</precondition>
  <postcondition>Step 1 calls check-conventions-staleness.ts first. If stale: false → skip regeneration. If stale: true → regenerate CONVENTIONS.md normally, then call check-conventions-staleness.ts --update to save new hashes.</postcondition>
</behavior>

<behavior name="talk-inline-cache-covers-phase">
  <precondition>talk.md inline path step 8i(b) uses LLM reasoning to decide if explore is needed</precondition>
  <postcondition>Check init-phase output.cacheCoversPhase. If true → skip explore agents for this phase, log "Cache covers phase N — skipping explore". If false → LLM evaluates uncoveredFiles and decides whether explore is needed.</postcondition>
</behavior>

<behavior name="fix-fast-path">
  <precondition>fix.md Step 3 always launches 2-3 Explore agents</precondition>
  <postcondition>When input contains file:line pattern AND explicit action verb (fix, change, rename, add, remove) → skip Explore agents, read the referenced file directly, keep 1 confirmative clarification round (Step 4) before execution.</postcondition>
</behavior>

<behavior name="build-cache-covers-phase">
  <precondition>build.md Step 2b uses LLM reasoning to decide if cache covers the phase</precondition>
  <postcondition>Check init-phase JSON output.cacheCoversPhase. If true → skip explore agents, log "Cache covers phase N". If false → proceed with current LLM evaluation of uncoveredFiles to decide exploration scope.</postcondition>
</behavior>

<invariant>All changes preserve existing behavior for medium/complex plans — optimizations only activate for simple/low-risk plans or when deterministic checks confirm safety</invariant>
</spec>

<tasks>
#### 1. Conventions Staleness Script
- **ID**: conventions-staleness-script
- **Assigned To**: builder-1
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: check-conventions-staleness, staleness-sampling-alignment, hash-storage-format
- Create `scripts/check-conventions-staleness.ts` following existing script patterns (parseArgs from lib/args.ts, JSON output, process.exit)
- Use same SAMPLE_DIRS and CODE_EXTS arrays as `scripts/map-conventions.ts` (import or duplicate the constants)
- Implement SHA-256 hashing of: (a) package.json dependencies+devDependencies block, (b) concatenated first 50 lines of sampled source files
- Read/write `.devorch/conventions-hash.json` with schema `{ depsHash, sourceHash, checkedAt }`
- Handle edge cases: missing package.json (exit 1), corrupted hash file (treat as stale), missing .devorch/ dir (create with --update)
- commit with `feat(scripts): add check-conventions-staleness.ts for hash-based freshness detection`

#### 2. Init Phase Parallelization and Cache Coverage
- **ID**: init-phase-improvements
- **Assigned To**: builder-2
- **Model**: opus
- **Effort**: medium
- **Spec refs**: init-phase-cache-coverage, init-phase-async-parallelization, cache-covers-phase-logic
- In `scripts/init-phase.ts`, convert the sequential `Bun.spawnSync` calls for map-project.ts and tldr-analyze.ts to parallel `Bun.spawn` + `Promise.allSettled`
- Preserve graceful degradation: if map-project fails → projectMap stays "", if tldr-analyze fails → tldrByFile stays empty object. Each spawn gets independent error handling.
- Add `cacheCoversPhase: boolean` and `uncoveredFiles: string[]` fields to the JSON output
- Compute cacheCoversPhase after the existing filterCache logic: extract file paths from phase relevant-files, check if each appears in at least one cache section. All covered → true. Any missing → false with list.
- Ensure output JSON always includes both new fields (default: false, [] when no cache)
- commit with `feat(scripts): parallelize init-phase subprocesses and add cacheCoversPhase output`

#### 3. Talk Command Speed Optimizations
- **ID**: talk-md-changes
- **Assigned To**: builder-3
- **Model**: opus
- **Effort**: medium
- **Spec refs**: da-auto-skip, talk-fast-path, talk-conventions-staleness-script, talk-inline-cache-covers-phase
- In `commands/talk.md` Step 1: Replace the LLM-driven CONVENTIONS.md staleness check with a call to `bun $CLAUDE_HOME/devorch-scripts/check-conventions-staleness.ts`. If output.stale is false → skip regeneration. If true → regenerate normally, then call with --update to save hashes.
- In `commands/talk.md` Step 2: Add fast-path condition — when input has specific file paths + explicit action + sufficient context, reduce to 1 Explore agent at "medium" thoroughness and 1 confirmative clarification round in Step 3
- In `commands/talk.md` Step 6b: Add DA auto-skip condition before the Explore agent launch. Skip when ALL hold: complexity=simple, risk=low, totalTasks ≤ 2, totalPhases == 1, no secondary-repos. Log "DA skipped" and proceed to Step 7.
- In `commands/talk.md` inline path Step 8i(b): Add cacheCoversPhase check from init-phase output. If true → skip explore agents with log message.
- Preserve all existing behavior for plans that don't match skip conditions
- commit with `feat(commands): add speed optimizations to talk.md — DA skip, fast-path, staleness script, cache coverage`

#### 4. Fix and Build Command Fast-Paths
- **ID**: fix-build-md-changes
- **Assigned To**: builder-4
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: fix-fast-path, build-cache-covers-phase
- In `commands/fix.md` Step 3: Add fast-path condition — when input contains file:line pattern AND explicit action verb → skip Explore agents, read file directly, keep 1 confirmative clarification (Step 4)
- In `commands/build.md` Step 2b: Add cacheCoversPhase check from init-phase output. If true → skip explore agents with log "Cache covers phase N". If false → proceed with current LLM evaluation.
- Preserve all existing behavior for inputs that don't match fast-path conditions
- commit with `feat(commands): add fast-path to fix.md and cacheCoversPhase to build.md`
</tasks>

<execution>
**Wave 1** (parallel): conventions-staleness-script, init-phase-improvements
**Wave 2** (after wave 1): talk-md-changes, fix-build-md-changes
</execution>

<criteria>
- [ ] check-conventions-staleness.ts exists and outputs correct JSON schema
- [ ] check-conventions-staleness.ts uses same SAMPLE_DIRS and CODE_EXTS as map-conventions.ts
- [ ] init-phase.ts runs map-project + tldr-analyze in parallel via Promise.allSettled
- [ ] init-phase.ts output JSON includes cacheCoversPhase and uncoveredFiles fields
- [ ] talk.md Step 1 calls check-conventions-staleness.ts instead of LLM comparison
- [ ] talk.md Step 2 has fast-path for specific inputs
- [ ] talk.md Step 6b has DA auto-skip for simple/low plans
- [ ] talk.md inline path uses cacheCoversPhase
- [ ] fix.md Step 3 has fast-path for file:line + action inputs
- [ ] build.md Step 2b uses cacheCoversPhase from init-phase output
- [ ] All existing behavior preserved for non-matching conditions
</criteria>
</phase1>
