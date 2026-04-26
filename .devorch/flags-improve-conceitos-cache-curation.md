# Flags: improve-conceitos-cache-curation

## scripts/map-project.ts:202 — --persist writes to legacy .devorch/project-map.md path
**Tipo**: ops
**Severidade**: medium
**Detecção**: `--persist` flag still writes to `.devorch/project-map.md`, not migrated to `cache/project-map.md`
**Risco**: New cache directory structure introduced but map-project persists to legacy location; new worktrees may read stale or inconsistent project map data if they expect `cache/project-map.md` layout.
**Correção sugerida**: Update `map-project.ts:202` to write to `.devorch/cache/project-map.md` or verify that the consume path (init-phase) still reads from legacy location.
**Ação**: [x] fix-now  [ ] new-plan  [ ] ciente-deixar

## hooks/post-compact-state-refresh.ts:59 — reads legacy .devorch/state.md only
**Tipo**: ops
**Severidade**: medium
**Detecção**: Hook reads from `.devorch/state.md` (line 59) without checking for new `cache/state.json` path; plan migration to JSON may silently report stale state.
**Risco**: New worktrees migrated to JSON state format will have post-compact hook output outdated state from old markdown file; orchestrator may misreport plan progress or phase status after compactions.
**Correção sugerida**: Update hook to prefer `cache/state.json` (parsed) with fallback to legacy markdown for backwards compatibility.
**Ação**: [x] fix-now  [ ] new-plan  [ ] ciente-deixar

## scripts/list-worktrees.ts:41 — regex mismatch with phase-summary output format
**Tipo**: ops
**Severidade**: medium
**Detecção**: Regex `/^Status:\s*(.+)$/m` (line 41) expects `Status:` at line start, but phase-summary writes `- Status:` (markdown bullet); fallback always returns "not started" / lastPhase 0 for in-progress legacy worktrees.
**Risco**: `list-worktrees.ts` reports incorrect status/lastPhase for worktrees created before JSON state migration; CI/orchestrator may trigger unnecessary rebuilds or skip valid in-progress work.
**Correção sugerida**: Update regex to `/^\s*- Status:\s*(.+)$/m` or accept both bullet and non-bullet formats.
**Ação**: [x] fix-now  [ ] new-plan  [ ] ciente-deixar

## scripts/lib/task-filter.ts:9-18 — extractFileRefs only matches backtick-quoted paths
**Tipo**: architecture
**Severidade**: low
**Detecção**: `extractFileRefs()` matches only backtick-quoted paths with `/` or extension suffix; bare filename mentions in task titles or `**Exemplars**:` lines are not extracted.
**Risco**: Tasks with exemplar files listed as bare names (not backtick-quoted) will not be associated with gotchas or code context for those files; exemplars become invisible to gotcha-matching pipeline.
**Correção sugerida**: Extend regex to also match bare filenames in `**Exemplars**:` section or document backtick-quote requirement in PLAN-FORMAT.
**Ação**: [ ] fix-now  [ ] new-plan  [x] ciente-deixar

## scripts/lib/task-filter.ts:14 — gotcha matching by basename may leak across directories
**Tipo**: architecture
**Severidade**: low
**Detección**: `extractFileRefs()` returns bare basenames or paths; gotcha filtering uses tail-match (basename only), so `utils.ts` in `scripts/utils.ts` and `lib/utils.ts` will both match identical gotchas.
**Risco**: Projects with multiple files of same basename across directories (e.g. `index.ts`, `utils.ts`, `config.ts` in multiple subdirs) will incorrectly share gotchas meant for one copy; false positives in gotcha curation.
**Correção sugerida**: Match full relative paths instead of basenames, or require exemplars to use full paths with `/` included.
**Ação**: [ ] fix-now  [ ] new-plan  [x] ciente-deixar

## Orphaned legacy state files in worktree
**Tipo**: ops
**Severidade**: low
**Deteccion**: `.devorch/state.md` and `.devorch/project-map.md` exist as untracked files in worktree root (migration orphans).
**Risco**: Cluttered worktree, potential confusion if user manually edits legacy files expecting them to be read by new scripts.
**Correção sugerida**: Add `.devorch/state.md` and `.devorch/project-map.md` to `.gitignore` in worktree, or document that these are safe to delete after migration.
**Ação**: [x] fix-now  [ ] new-plan  [ ] ciente-deixar
