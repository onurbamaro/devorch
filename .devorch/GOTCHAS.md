# Gotchas

- **`git()` wrapper trims stdout** (`scripts/merge-worktree.ts:43-53`) — Callers needing byte-exact output (e.g. `removeIdenticalUntracked` comparing untracked file bytes to `git show <branch>:<path>`) must bypass the wrapper with raw `Bun.spawnSync`; the wrapper's `.trim()` silently alters trailing whitespace and newlines.
