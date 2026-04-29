# merge-worktree cleanup retry crashes with ENOENT after partial worktree removal

**Timestamp**: 2026-04-28
**Severity**: gap

## Prompt
/devorch "in merge-worktree.ts cleanupRepo retry path: when `git worktree remove` fails (e.g. 'contains modified or untracked files'), the script retries with --force. Between attempts the worktree directory may have been partially removed, so the spawnSync that uses `cwd: <worktreePath>` to invoke git crashes with `ENOENT posix_spawn 'git'` — misleading because git is in PATH; the real failure is the cwd. Either (a) re-resolve cwd to mainRoot before the retry git call, since `git worktree remove --force <name>` works from anywhere with the worktree-name argument, or (b) catch ENOENT on cwd and fall back to mainRoot. The cleanup actually succeeds (worktree dir vanishes from `git worktree list`) but the script exits with `ok:false`, leaving the orchestrator to manually delete the leftover branch via `git branch -d devorch/<name>`."

## Context

- **Where**: Step 13 (merge), `merge-worktree.ts:513` (`cleanupRepo`), retry with `--force` after first `worktree remove` fails.
- **What happened**: First attempt failed with `fatal: '/home/bruno/dev/dochron/.worktrees/backend-data-integrity-sweep' contains modified or untracked files, use --force to delete it`. Retry threw `Error: ENOENT: no such file or directory, posix_spawn 'git'` from `spawnSync` at `merge-worktree.ts:44`. Final JSON: `{"ok": false, "error": "unexpected", "detail": "ENOENT: no such file or directory, posix_spawn 'git'"}`.
- **Reality on disk after the crash**: worktree directory is gone, `git worktree list` no longer shows it (cleanup did succeed at the filesystem level); the merged branch `devorch/<name>` is still alive locally and needs `git branch -d` by hand.
- **Expected**: Final JSON should report cleanup success even when the retry hits transient cwd issues. Branch deletion should still happen.
- **Workaround**: Orchestrator runs `git branch -d devorch/<name>` post-script. (Combined with the still-open archival-on-gitignored-devorch issue from 2026-04-27, every devorch run on this repo currently needs ~3 manual git commands to finish cleanup.)
- **Root cause hypothesis**: `spawnSync('git', args, { cwd: <worktreePath> })` — Node returns ENOENT on the spawn when cwd no longer exists, surfacing it as "git not found" (truly misleading). Fix: pass `cwd: mainRoot` for the cleanup retry, or `process.chdir(mainRoot)` before the retry.
