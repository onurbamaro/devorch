# Explore Cache
Generated: 2026-04-10T12:00:00Z

## Phase Pipeline Overhead

### Script inventory and timing
| Script | Lines | Typical Time |
|---|---|---|
| `init-phase.ts` | 677 | 108ms (no TS refs) to 3.9s (18+ TS refs) |
| `check-project.ts` | 210 | 2.1s (devorch) to 15.5s (large Next.js) |
| `phase-summary.ts` | 104 | ~25ms |
| `manage-cache.ts` | 133 | ~25ms |
| `tldr-analyze.ts` | 289 | 0 (skipped) to 4s (ts-morph AST) |

### Where time actually goes
- **check-project.ts (tsc)** dominates: 2-15s per phase depending on project size
- init-phase.ts spawns map-project + tldr-analyze **sequentially** via Bun.spawnSync
- map-project.ts already has 5-min mtime cache in init-phase.ts
- tldr-analyze.ts has zero caching — re-parses same TS files every phase
- phase-summary.ts and manage-cache.ts are negligible (~25ms each)

### Consolidation verdict
Merging init-phase + phase-summary + manage-cache saves ~27ms (2 Bun startups + 1 plan re-read). **Not worth it** — the real bottleneck is tsc in check-project.ts. build.md already overlaps check-project and next-phase init-phase in parallel.

### Actionable optimizations in scripts
1. **Parallelize map-project + tldr-analyze in init-phase.ts** — change from sequential Bun.spawnSync to async Promise.all. Saves ~55ms.
2. **Cache tldr-analyze results** keyed on `<filePath>:<mtime>` — avoids ts-morph re-parsing same files across phases. Saves 1-4s per phase on TS-heavy projects.
3. **tsc incremental mode** in check-project.ts — pass `--incremental` for `.tsbuildinfo` reuse. Saves 10-14s on large projects after first run. Risk: stale buildinfo can suppress errors.

## Talk/Build Command Flow — LLM vs Deterministic

### Steps that are pure LLM (cannot be scripted)
- Explore agent runs (codebase discovery)
- Clarification rounds with user (Step 3)
- Spec proposal and plan writing (Steps 3b, 6, 7)
- Builder agent execution
- Adversarial review analysis
- Finding severity triage (Trivial/Fix-level/Talk-level)

### Steps currently LLM that could be deterministic scripts

| Step | File | Current | Proposed Script | Impact |
|---|---|---|---|---|
| CONVENTIONS.md staleness | talk.md:78 | LLM reads+compares deps | `check-conventions-staleness.ts` with pkg-hash | Medium — every talk call |
| DA skip for simple plans | talk.md:198 | Always runs (~1-3 min) | Auto-skip if simple+low+≤2 tasks+1 phase | **High** — most common for small tasks |
| Fix investigation fast-path | fix.md:44 | Always 2-3 Explore agents | Skip if input has file:line + explicit action | **High** — common developer use case |
| Cache coverage check | build.md:74 | LLM judgment | `init-phase.ts` adds `cacheCoversPhase: boolean` | Medium — per-phase in build |
| Plan classification accuracy | talk.md step 6 | LLM estimates complexity/risk | `classify-plan.ts` from plan metrics | Medium — prevents misclassification |
| Routing inline/worktree | talk.md:168 | LLM evaluates count+repos | Deterministic from task count + repos | Low — one-time per session |

### DA (Devil's Advocate) auto-skip conditions
Currently always runs (talk.md line 198 "automatic"). Proposed skip when ALL hold:
1. Complexity == "simple"
2. Risk == "low"  
3. Total tasks ≤ 2
4. Single phase
5. No secondary-repos

### Fix.md fast-path
fix.md Step 3 always launches 2-3 Explore agents. When user provides `file:line` + explicit action, investigation is purely confirmatory. A `classify-fix-context.ts` could detect this and skip to Step 5.

### CONVENTIONS.md hash-based staleness
Store `package.json` hash in `.devorch/conventions-hash.json`. Compare on talk invocation. If match → not stale, skip LLM analysis entirely.

## Script Architecture — New Script Opportunities

### Proposed new scripts (by priority)

1. **`check-conventions-staleness.ts`** — Hash package.json deps + source file samples, compare to stored hash. Output: `{stale: boolean, reason: string}`. Replaces LLM-driven library comparison.

2. **`classify-plan.ts`** — Compute phaseCount, taskCount, fileCount, repoCount, hasEndpoints, hasSatellites. Output suggested complexity/risk with thresholds:
   - simple: ≤2 phases, ≤4 tasks, ≤6 files, single repo
   - complex: ≥4 phases OR ≥10 tasks OR ≥15 files OR multi-repo
   - medium: everything else

3. **`classify-input.ts`** — Parse user input for signal words (fix/bug/error → FIX, add/implement/feature → TALK), file:line patterns, input length. Output: `{classification, confidence, signals}`.

4. **`build-task-prompt.ts`** — Assemble full builder prompt deterministically from init-phase JSON. Replaces LLM string manipulation for convention filtering, spec injection, cache section injection.

### Existing scripts with proposed changes
- **init-phase.ts**: (a) parallelize map-project + tldr-analyze, (b) add `cacheCoversPhase: boolean` to output, (c) return full filtered convention text per task (not just header names)
- **validate-plan.ts**: add `--score` flag for plan quality metrics (phaseCount, taskCount, specCoverage, waveParallelism, estimatedTokenWeight)
- **check-project.ts**: add `--incremental` support for tsc

### Install system
`install.ts` copies all scripts to `~/.claude/devorch-scripts/`. No registration needed — command files reference scripts by absolute path. Adding a new script requires only creating the file and running `bun run install`.
