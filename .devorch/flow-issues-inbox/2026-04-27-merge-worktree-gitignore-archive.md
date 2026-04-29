# merge-worktree.ts archival commit fails silently when `.devorch/` is gitignored

**Timestamp**: 2026-04-27
**Severity**: gap

**Prompt pronto**:
```
/devorch "fix merge-worktree.ts archival stage to use git add -f when staging files under a gitignored prefix (.devorch/). Today the archival of plans/<name>.md → plans/archive/<date>-<name>.md is staged with plain `git add`, which fails on repos that gitignore .devorch/ and was patched ad-hoc by every devorch session that adopted the .gitignore pattern. The merge succeeds but archival is left half-done — the active plan file is removed from disk but the deletion+archive rename never gets committed, requiring orchestrator manual fixup. Detect the gitignore situation (or always use --force; the path is always inside .devorch/) and finish the archival commit cleanly."
```

## Contexto

- **Onde**: `merge-worktree.ts` step that runs after the merge commit; it tries to `git mv` (or rename + add) the active plan file to the archive folder, then commit.
- **O que aconteceu**: `Archival stage failed: The following paths are ignored by one of your .gitignore files: .devorch hint: Use -f if you really want to add them.` Script returned `ok: true` for the merge itself, but `archivalCommit: null`. On-disk state had the file moved correctly, but `git status` showed a staged "deleted" for the active plan (no matching addition for the archive copy because `.devorch/` was ignored).
- **Esperado**: archival commit succeeds even when `.devorch/` is gitignored — script should `git add -f` for files under the `.devorch/` prefix, since that's where the script always operates.
- **Workaround usado**: orchestrator detected the failure in JSON output, manually ran:
  ```
  git add -f .devorch/plans/archive/<date>-<name>.md
  git commit -m "chore(devorch): archive plan — <name>"
  ```
  to finish the move that the script started.
- **Sintoma colateral**: same pattern (`.gitignore` blocks `.devorch/` writes) also forced manual `git add -f` on the **plan commit** in Step 8 and the **gotchas commit** in Step 14. Those steps are orchestrator-driven (no script), so the orchestrator can adapt — but `merge-worktree.ts` is a script and silently half-completed its job.

## Why this matters

The script's atomicity contract reads "merge succeeded → archival committed → worktree removed". When archival silently fails, the post-merge state is dirty (staged deletion of active plan, untracked archive file). A user not paying attention will commit something else next and accidentally include the staged deletion in their next commit, OR push the dirty state. The orchestrator caught it this time, but only because I read the script's stderr carefully.
