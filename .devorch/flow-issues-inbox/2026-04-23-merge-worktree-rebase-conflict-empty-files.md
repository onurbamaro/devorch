# merge-worktree.ts: "rebase-conflict" with empty conflictFiles

**Timestamp**: 2026-04-23
**Mode**: full
**Severity**: gap

## Prompt pronto

```
/devorch --full "fix merge-worktree.ts to distinguish pre-existing dirty-worktree state from actual rebase conflicts — when git rebase fails to start due to unstaged changes, the script currently reports 'rebase-conflict' with conflictFiles: []. Should either abort earlier with a clearer 'dirty-worktree' reason, or detect the state at guard-time before invoking rebase."
```

## Contexto mínimo

**Onde**: `merge-worktree.ts` rebase phase.

**O que aconteceu**: First run of `merge-worktree.ts --worktree profile-achievements-system --satellites '[...]'` returned:
```json
{
  "ok": false,
  "error": "Rebase conflict in primary ... against master",
  "phase": "rebase",
  "failedRepos": [{ "role": "primary", "reason": "rebase-conflict", "conflictFiles": [] }]
}
```

The worktree had 1 unstaged file (`.devorch/project-map.md`) and 3 untracked flags-*.md files — pre-existing dirt from the session's internal tooling (map-project.ts output etc.), not actual rebase conflicts. `git rebase` refused to start because of the unstaged change.

**Esperado**: Either (a) the guard-time check should detect unstaged changes in the worktree and surface `"reason": "dirty-worktree"` with the file list, OR (b) the script should auto-stash .devorch-namespaced dirt before rebase (since they're devorch's own artifacts).

**Workaround aplicado**: `git stash push -u .devorch/project-map.md .devorch/flags-*.md` manually, retry merge.

**Impacto**: orchestrator spent ~2 minutes diagnosing what looked like a real rebase conflict before realizing it was dirty-worktree. Empty conflictFiles is a false signal — clearer error would shave time.
