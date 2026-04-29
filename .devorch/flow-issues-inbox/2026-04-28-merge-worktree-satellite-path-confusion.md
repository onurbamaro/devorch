# merge-worktree.ts satellite path error misleading when caller passes worktreePath

**Timestamp**: 2026-04-28T17:46Z
**Severity**: nit

## Prompt
`/devorch "in merge-worktree.ts, when --satellites JSON 'path' resolves to a directory that already ends in '.worktrees/<name>', detect and either accept it or surface a clearer error like 'expected repo root, received worktree path'"`

## Context

Per docs/SCRIPTS.md, the `--satellites` JSON's `path` field is the **repoPath** (repo root). The script appends `.worktrees/<name>` internally. But devorch.md Step 13 says satellites have `path` = `repoPath`, AND Step 9e says `path` is also `repoPath` — yet phase-summary.ts symmetry suggests `worktreePath`. The orchestrator can easily pass the wrong one.

## What happened

First merge attempt used `path: "/home/bruno/dev/salsago-core/.worktrees/order-tracker-with-map"` (worktreePath, copied from setup-worktree.ts return). Error returned was:
```
Worktree for satellite "salsago-core" not found: /home/bruno/dev/salsago-core/.worktrees/order-tracker-with-map/.worktrees/order-tracker-with-map
```
The doubled `.worktrees/.../.worktrees/...` suffix made the issue obvious in retrospect, but the immediate signal "Worktree not found" suggested the worktree was missing, not that the input was wrong.

## Expected

Error message: "Expected satellite path to be repoPath; received '<X>' which already ends in `.worktrees/<name>` — did you pass worktreePath?".

## Workaround used

Re-ran with `path: "/home/bruno/dev/salsago-core"`.

## Suggested fix

In `merge-worktree.ts` satellite resolution, detect if `path` ends in `.worktrees/<name>` and either auto-correct (strip suffix) or surface the clearer error above. Two-line change.
