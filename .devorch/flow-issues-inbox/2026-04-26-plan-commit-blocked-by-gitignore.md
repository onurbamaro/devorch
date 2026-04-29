# Plan commit + archival commit blocked by `.devorch/` in gitignore

**Timestamp**: 2026-04-26
**Severity**: gap

## Prompt to fix

```
/devorch "When the user's repo gitignores .devorch/, devorch's own plan/gotchas/state commits silently fail because git refuses to add ignored paths without -f. Detect this case in setup-worktree.ts (or whenever plan/gotchas/state get staged) and either: (a) auto-pass -f for paths under .devorch/, OR (b) surface a one-time setup hint suggesting the user add an explicit !.devorch/plans/ allow-rule. Currently failing in two places: Step 8 plan commit and Step 13 merge-worktree archival commit (the latter outputs 'Archival stage failed: paths ignored' and proceeds without recording the active→archive transition)."
```

## Context

- Where: `/home/bruno/dev/salsago-menu` — user has `.devorch/` in `.gitignore` (commit `20d1a00 chore(gitignore): ignore .devorch/ and untrack existing files`).
- What happened: Step 8 plan commit refused with "paths ignored by one of your .gitignore files; Use -f if you really want to add them". I worked around with `git add -f`. Later, `merge-worktree.ts` archival commit hit the same wall — printed "Archival stage failed:" and continued without committing the archive→active transition (`archivalCommit: null` in the output JSON).
- Expected: devorch's own internal artifacts (plans, gotchas, state) should commit cleanly even when the host project gitignores `.devorch/`.
- Workaround: orchestrator added `-f` manually. The merge-worktree archival just left the file deletion staged; user can commit it later or ignore.
