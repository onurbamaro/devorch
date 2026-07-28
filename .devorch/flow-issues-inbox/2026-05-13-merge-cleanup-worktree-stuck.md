# merge-and-cleanup --phase cleanup fails to remove worktree directory after self-archive commit

Timestamp: 2026-05-13

Severity: nit

Prompt pronto:
```
/devorch "make merge-and-cleanup.ts cleanup phase tolerate worktrees that already self-archived (git worktree remove may fail with 'not a working tree' when the worktree's archive commit was made inside it before cleanup runs); fall back to rm -rf + git worktree prune"
```

## Contexto

Onde: `C:/Users/bruno/.claude/devorch-scripts/merge-and-cleanup.ts` cleanup phase.

O que aconteceu: After resolving merge conflicts manually and committing in mainRoot, ran `merge-and-cleanup.ts --phase cleanup`. Output: `{"ok":false,"phase":"cleanup","worktreeRemoved":false,"branchDeleted":true,"worktreeRemoveError":"fatal: '...prepublication-playstore-fixes' is not a working tree"}`. Branch deletion succeeded; worktree directory remained orphaned. Manual `git worktree prune && rm -rf .worktrees/<name>` cleared it.

Esperado: cleanup completes idempotently regardless of internal commit state.

Workaround usado: `git worktree prune` then `rm -rf .worktrees/<name>`.

Solução durável: cleanup phase should:
1. Try `git worktree remove --force <path>` first.
2. If that errors with "not a working tree" (or similar), run `git worktree prune` then `rm -rf <path>`.
3. Return ok:true if directory is gone after step 2, even if step 1 errored.
