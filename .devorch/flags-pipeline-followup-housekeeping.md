# Flags: pipeline-followup-housekeeping

## scripts/setup-worktree.ts:98, 113, 120 — exit codes ignored on cleanup spawns
**Tipo**: ops  
**Severidade**: low  
**Detecção**: Three `Bun.spawnSync` calls to `git sparse-checkout disable` (cleanup) don't check exitCode. Lines 98, 113, 120 in applySparseCheckout().  
**Risco**: Silent failure during sparse-checkout rollback leaves worktree in inconsistent state. Follow-up builds inherit the broken sparse-checkout state.  
**Correção sugerida**: Check exitCode on cleanup spawns; log warning if disable fails but don't re-throw (already in exception handler).  
**Ação**: [ ] fix-now  [ ] new-plan  [x] ciente-deixar

## scripts/lib/args.ts:49 — number coercion ignores NaN from parseInt
**Tipo**: ops  
**Severidade**: low  
**Detecção**: parseArgs uses `parseInt(val, 10)` without checking for NaN. Malformed `--timeout abc` will set `0` (default), not error. Line 49.  
**Risco**: Silent substitution of 0 for invalid numeric flags masks user typos (e.g., `--timeout notanumber` accepted as `--timeout 0`).  
**Correção sugerida**: Validate `!Number.isNaN(parsed)` after parseInt; fail with usage error if invalid.  
**Ação**: [ ] fix-now  [ ] new-plan  [x] ciente-deixar

## scripts/setup-worktree.ts:512–514 — output.cachePrewarmSkipped untyped in JSON
**Tipo**: architecture  
**Severidade**: low  
**Detecção**: `cachePrewarmSkipped: true` added to JSON output (line 512–514) with no TypeScript interface. JSON output is polymorphic (sometimes includes it, sometimes doesn't) — orchestrator must guard each access.  
**Risco**: Orchestrator code that parses setup-worktree output must check `.cachePrewarmSkipped !== undefined` or risk false negatives when field is absent.  
**Correção sugerida**: Define explicit JSON output type interface; emit all fields always (cachePrewarmSkipped defaults to false when not set).  
**Ação**: [ ] fix-now  [x] new-plan  [ ] ciente-deixar

## scripts/validate-plan.ts:145–152 — file-mention regex for warn rule is narrow
**Tipo**: architecture  
**Severidade**: low  
**Detecção**: Lines 369–372 (wave-conflict detection) and 405–407 (warn rule) use backtick regex `/`([^`\s<>]+\.(?:ts|tsx|js|jsx|md|sql|json|yaml|yml|sh|py|css|html))`/g` — excludes extensions .ts**c**, .jsx → no TypeScript component files. Detects common formats but misses project-specific conventions (e.g., .config.ts, .d.ts, .mjs).  
**Risco**: Tasks that mention config files or type definitions in backticks won't trigger the undeclared-path warning. Plan author may miss declaring them in relevant-files.  
**Correção sugerida**: Expand extension list or switch to broader pattern (any backtick path ending with dot + 1-5 chars). Document the limitation in validate-plan comments.  
**Ación**: [ ] fix-now  [x] new-plan  [ ] ciente-deixar

## scripts/lib/constants.ts — single constant file; magic numbers elsewhere
**Tipo**: architecture  
**Severidade**: low  
**Detecção**: New constants.ts exports only CACHE_FRESHNESS_MS. Other scripts have hardcoded magic numbers: check-project.ts lines 29–31 (DEFAULT_TIMEOUT_MS, TEST_TIMEOUT_MS, QUICK_TIMEOUT_MS); tldr-analyze.ts and others have implicit limits (max tree depth, token budgets, regex sizes).  
**Risco**: Timeout and performance thresholds scattered across scripts. No single source of truth for tuning timeouts at runtime (e.g., slow CI environment needs longer waits).  
**Correção sugerida**: Extend constants.ts to cover all timeout + limit thresholds; import in check-project, merge-worktree, init-phase.  
**Ação**: [ ] fix-now  [x] new-plan  [ ] ciente-deixar

## commands/devorch.md:162 — Step 7.5 sub-rule 2 grep escaping asymmetry
**Tipo**: ops  
**Severidade**: low  
**Detecção**: Sub-rule 2 (line 162) adds note: "Escapar metachars (`.`, `*`, `+`, `[`) — alternation só cobre paths literais simples; para paths com chars especiais, separe em greps individuais." However, sub-rule 1 candidate generation (lines 155–160) does not define which candidates are simple literals vs. complex patterns, leaving it to orchestrator judgment at dispatch time.  
**Risco**: Orchestrator may batch candidates with regex metacharacters into a single grep, producing false matches or parse failures.  
**Correção sugerida**: In Step 7.5 sub-rule 1, annotate candidates as `literal` or `regex` so sub-rule 2 knows whether batching is safe. Or require sub-rule 2 to pre-scan candidates for metachars before composing alternation.  
**Ación**: [ ] fix-now  [x] new-plan  [ ] ciente-deixar

## docs/PLAN-FORMAT.md:42–56 — </relevant-files> moved outside comment block
**Tipo**: ops  
**Severidade**: low  
**Detección**: Diff shows `</relevant-files>` moved from line 57 (inside comment) to line 43 (before comment), and closing comment tag removed. Structure now shows `<relevant-files>...\n</relevant-files>\n\n<!-- comment -->` — the comment no longer documents the nested <secondary-repos> context it intended to. Future plan authors won't see the note that `path` is repoPath for satellites.  
**Risco**: Plan authors may misunderstand how to fill `<relevant-files>` paths for satellite repos — will use worktree paths instead of repoPath, causing path mismatches in wave-overlap detection.  
**Correção sugerida**: Restore comment block inside or immediately after `</relevant-files>` tag to document satellite path semantics (use repoPath, not worktreePath).  
**Ación**: [x] fix-now  [ ] new-plan  [ ] ciente-deixar
