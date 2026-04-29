# merge-worktree cleanup crashes ENOENT when invoked from inside the worktree being removed

**Timestamp**: 2026-04-28
**Severity**: gap

## Prompt to fix

```
/devorch "merge-worktree.ts cleanupRepo step crashes with `Error: ENOENT: no such file or directory, posix_spawn 'git'` when the orchestrator's cwd was the worktree directory at script invocation time. The worktree gets removed earlier in cleanup, then subsequent git calls (e.g., branch -d) fail because cwd no longer exists. Two fixes worth considering: (a) at script entry, chdir to mainRoot regardless of where the orchestrator called from, AND/OR (b) wrap the post-removal git operations in a try-catch that retries with explicit cwd = mainRoot when ENOENT/getcwd surfaces. Today the failure mode is: merge succeeds, plan archived, worktree dir removed — but branch deletion never runs and the orchestrator must manually `git branch -d devorch/<name>`."
```

## Context

- **Where**: Step 13 (merge), `merge-worktree.ts` `cleanupRepo` function (around line 513).
- **What happened**: After merge succeeded (commit `3860c08`) and the worktree directory was removed by `git worktree remove`, the next git invocation in `cleanupRepo` (presumably `git branch -d devorch/<name>` or similar) fired `posix_spawn 'git'` from a Bun process whose cwd had just been deleted. The shell can no longer resolve cwd → ENOENT bubbles up. After exit, `pwd` reported `error retrieving current directory: getcwd: cannot access parent directories: No such file or directory` confirming the orphaned cwd.
- **Expected**: Cleanup completes regardless of orchestrator's invocation cwd. Branch is deleted. Final JSON `ok: true`.
- **Workaround**: After script exits with `ok: false, error: "unexpected", detail: "ENOENT..."`, orchestrator manually runs `cd <mainRoot>` then `git branch -d devorch/<name>` to finish cleanup.
- **Compound effect**: This bug stacks on top of the gitignored-`.devorch` archival issue (`2026-04-27-archival-commit-fails-on-gitignored-devorch.md`) — the archival failure cascaded into the cleanup crash because the script kept trying subsequent steps. With both unfixed, a normal `/devorch` run leaves both `archivalCommit: null` AND `cleanup: incomplete` in its wake.
