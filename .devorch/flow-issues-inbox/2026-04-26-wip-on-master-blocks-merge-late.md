# WIP on master blocks merge in dry-run, surfaces only at the end

**Timestamp**: 2026-04-26
**Severity**: nit

## Prompt to fix

```
/devorch "merge-worktree.ts atomicity guard rejects when the main repo's branch (e.g., master) has uncommitted tracked changes, even if those changes are unrelated to anything in the worktree being merged. The user is told only at merge time, after a full build + adversarial review (potentially 30+ minutes of work). Step 2 already detects WIP on the original branch and surfaces a one-line note. Add a parallel check at merge time, OR: have the orchestrator (or a hook) offer to stash-merge-unstash automatically when the only blocker is WIP on the destination branch, OR: surface the recoverable nature earlier so the user can plan."
```

## Context

- Where: `/home/bruno/dev/salsago-menu` had `M astro.config.mjs` and `M src/lib/cart-store.ts` on master throughout the build.
- What happened: setup-worktree.ts (Step 2) properly noted the WIP and isolated the worktree. Build ran cleanly. At Step 13, merge-worktree.ts dry-run failed with "repo has uncommitted tracked changes" — atomicity guard correctly refused to merge into a dirty master.
- Workaround: orchestrator asked the user via AskUserQuestion how to proceed; user picked stash → merge → unstash. Stash pop auto-merged cleanly because the user's WIP on `cart-store.ts` did not conflict with the new `replaceCart`/`mergeCart` additions (lucky).
- Improvement: surface the WIP-on-destination case as a recoverable warning during init or even offer auto-stash. Right now it feels like a late surprise.
