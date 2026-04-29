# merge-worktree fails when mainRoot AND worktree both have dirty `.devorch/cache/project-map.md`

**Timestamp**: 2026-04-28
**Severity**: gap

**Prompt ready**:
```
/devorch "Make merge-worktree.ts auto-resolve conflicts on `.devorch/cache/project-map.md` (and `.devorch/cache/state.json`) by preferring mainRoot's version. These are operational metadata that both sides legitimately refresh during a session — the user should never need to handle them manually."
```

## Context

During a clean run (no user error), merge-worktree.ts failed FIVE times in a row, each time with a different cache-related obstruction. The root cause: `setup-worktree.ts` spawns `map-project` sync which writes to mainRoot's `.devorch/cache/project-map.md`. Then phase-summary.ts writes to worktree's `.devorch/cache/state.json`. By the end of the pipeline, both mainRoot and worktree have dirty cache files. Some are tracked (project-map.md), some aren't (state.json) — depending on whether they were force-added in a previous session.

## Sequence of failures

1. **Attempt 1**: `Dirty worktree (tracked changes) detected; refusing to rebase onto master` — worktree had `.devorch/cache/project-map.md` and `.devorch/cache/state.json` modified.
2. **Attempt 2 (after committing worktree's cache state with -f)**: `repo "..." has uncommitted tracked changes: M .devorch/cache/project-map.md` — but this time the dirty file was in mainRoot, not the worktree.
3. **Attempt 3 (after committing mainRoot's cache state)**: `Rebase conflict in primary "..."` on `.devorch/cache/project-map.md` — both branches now had divergent commits to the same cache file.
4. **Attempt 4 (after `git reset --soft HEAD~1` + `git checkout HEAD -- ...`)**: `Dirty worktree` again because state.json was still untracked-tracked.
5. **Attempt 5 (after `git checkout HEAD -- .devorch/cache/state.json`)**: succeeded. But:
   - `Archival stage failed: paths are ignored by .gitignore` — needs `-f` in the archival commit.
   - `worktree remove failed; retrying with --force` — likely fine.
   - `Unexpected error: ENOENT: no such file or directory, posix_spawn 'git'` — script's cwd was the worktree it just deleted; subsequent `git` invocations had no cwd.

## Expected behavior

`merge-worktree.ts` should:
- Treat `.devorch/cache/*` paths as ephemeral metadata. When dirty/conflict is detected ONLY on these paths in either side, auto-resolve (prefer mainRoot's version, or just discard the worktree's diff) without aborting the pipeline.
- Use `git add -f .devorch/...` for the archival commit (since `.devorch/` is in `.gitignore` for many host repos but specific files are force-tracked).
- Always `cd` to mainRoot before the cleanup phase so post-removal git invocations don't ENOENT on the deleted worktree's cwd.

## Workaround (used)

Manual: 5 retries with `git reset --soft`, `git checkout HEAD -- ...`, and creating an extra `chore(devorch): refresh project-map cache` commit on mainRoot. Took ~2 minutes of extra orchestrator time and looked alarming in the user-facing transcript.
