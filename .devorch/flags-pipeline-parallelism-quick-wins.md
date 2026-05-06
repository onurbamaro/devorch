# Flags: pipeline-parallelism-quick-wins

## scripts/validate-plan.ts:303–362 — Redundant task section splitting
**Tipo**: architecture
**Severidade**: low
**Detecção**: tasksContent is split via `/####\s+\d+\.\s+/` regex four times in the same per-phase loop (lines 303, 326, 362, 517 — the latter is in secondary-repos validation). Each split allocates a new array and rescans the entire tasks block.
**Custo estimado**: O(4 × N) where N = task count per phase. For large plans (~50 tasks) this is ~200 redundant regex operations.
**Correção sugerida**: Extract `taskSections = tasksContent.split(...)` once at the start of per-phase validation and reuse across all sub-validations.
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## scripts/setup-worktree.ts:411–421 — Bun.spawnSync exit codes ignored
**Tipo**: ops
**Severidade**: low
**Detecção**: Lines 411–421: `git diff --name-only` and `git ls-files` spawn with `stdout: "pipe"` but neither checks `exitCode`. Silent failure if .devorch is not a git-tracked directory or if git commands fail.
**Risco**: Malformed filesToCopy array (empty when both git commands fail), worktree created without required .devorch plans copied.
**Correção sugerida**: Check `diffProc.exitCode === 0 && untrackedProc.exitCode === 0` before reading stdout; fall back to empty array with warning if either fails.
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## scripts/setup-worktree.ts:444–456 — Cache pre-warm assumes writable mainRoot/.devorch/cache
**Tipo**: ops
**Severidade**: medium
**Detecção**: Lines 444–456: pre-warm copies project-map.md from `<mainRoot>/.devorch/cache/` to worktree. If mainRoot is read-only (CI, container, sandbox), mkdirSync at 451 will fail silently (caught by try/catch) and worktree starts without cache — no signal to orchestrator that cache miss occurred.
**Custo estimado**: ~5–10s per worktree map-project spawn; in CI with 10 worktrees, this is cumulative latency regression of ~50–100s.
**Correção sugerida**: Log a warning when cache pre-warm fails; set a flag in output JSON `"cachePrewarmSkipped": true` so orchestrator can decide whether to warn or proceed.
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## docs/PLAN-FORMAT.md:42–57 — Nested tag structure breaks expected XML hierarchy
**Tipo**: architecture
**Severidade**: low
**Detecção**: Lines 42–57: `<relevant-files>` opening tag at line 42, then `<new-files>` and `<secondary-repos>` nested inside as siblings without explicit nesting markers. Closing `</relevant-files>` is at line 57, after both inner tags close. Template is parsed by regex via extractTagContent (which uses `^...<tagName>...<\/tagName>`) so nesting works, but visual structure confuses readers.
**Risco**: Future readers may reorder or incorrectly parse the template; validate-plan.ts does not validate `<new-files>` or `<secondary-repos>` tags so mistakes go undetected.
**Correção sugerida**: Close `</relevant-files>` before `<new-files>`, or document that inner tags are conceptually sub-sections.
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## scripts/lib/plan-parser.ts:98–129 — Similar regex iteration pattern to removed extractExploreQueries
**Tipo**: architecture
**Severidade**: low
**Detecção**: parseSpecNames (lines 98–129) uses same pattern as deleted extractExploreQueries: iterate regex via exec() in while loop, accumulate results. Pattern is applied 4 times with subtle differences (implicit naming for invariants/endpoints; explicit name attributes for others).
**Risco**: Future refactorings may miss or duplicate one of the four branches. Invariant naming logic (invariant-N ordinals) is implicit and undocumented in function signature.
**Correção sugerida**: Add JSDoc documenting the four spec types and implicit naming rules; extract regex branches into named sub-functions for reuse.
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## commands/devorch.md:162 — Grep batch instruction assumes no regex escaping needed for pattern alternation
**Tipo**: architecture
**Severidade**: low
**Detecção**: Step 7.5 sub-rule 2 line 162 instructs batching greps as `grep -E '<pat1>|<pat2>|<pat3>'` without noting that special regex chars (`.`, `*`, `+`, `[`, etc.) must be escaped. If an inferred barrel path contains metachars (e.g., `src/a+b.ts`), the alternation breaks silently.
**Risco**: Implicit touches with special chars in filenames are not detected; waves don't re-order, tasks collide at build time.
**Correção sugerida**: Document escaping requirement in Step 7.5 sub-rule 2, or provide regex-escape helper to orchestrator.
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## commands/devorch.md:170 — Migration collision check path template ambiguous for satellites
**Tipo**: architecture
**Severidade**: low
**Detecção**: Step 7.5 sub-rule 4 line 170 says use `git -C <repo> ls-tree origin/<mainBranch>:<satellite>/db/migrations/` but `<repo>` is already the satellite's repoPath, so `<satellite>` in the tree path is undefined. Intent appears to be `git -C <satellite.repoPath> ls-tree origin/<mainBranch>:db/migrations/`.
**Risco**: If orchestrator interprets literally, git command fails for satellites and migration collisions won't be detected.
**Correção sugerida**: Clarify: "for satellite, use `git -C <satellite.repoPath> ls-tree origin/<mainBranch>:db/migrations/`" (same as primary, since git runs inside satellite repo).
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## scripts/validate-plan.ts:369–371 — Wave conflict detection treats file refs as definitive without path normalization
**Tipo**: architecture
**Severidade**: low
**Detecção**: Lines 369–371 extract file refs from tasks via regex matching backtick-quoted paths only (`/`([^`]*(?:\/[^`]+|\.\w{1,5}))`/g`). If a task description mentions a file in inline code or plain text, it is missed. Wave conflict detection is then incomplete.
**Risco**: Two tasks touching the same file via different citation styles (backtick vs plain) are not flagged as overlapping. Build-time conflict.
**Correção sugerida**: Expand file-ref extraction to include common patterns (import statements, path literals) or require explicit `<relevant-files>` entries; ignore task body mentions.
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar
