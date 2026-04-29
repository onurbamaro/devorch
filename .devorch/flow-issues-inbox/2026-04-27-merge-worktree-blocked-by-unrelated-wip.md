# merge-worktree blocked by unrelated WIP in main

**Timestamp**: 2026-04-27
**Severity**: gap

## Prompt
/devorch "make merge-worktree.ts handle pre-existing unrelated WIP in main: detect, auto-stash with a labeled stash entry, run the merge, pop the stash, and surface 'restored stash <ref>' in the result. Failure mode: if pop conflicts, leave the stash in place and surface its ref. The user should not have to choose between 'commit your WIP' and 'cancel devorch'."

## Context

- **Where**: Step 13 (merge), `merge-worktree.ts`.
- **What happened**: The user had 1 unrelated modified file in main (`ReferenceLapModal.tsx`) at merge time. The script aborted with `uncommitted tracked changes`. I had to surface a 3-option `AskUserQuestion` for the user to pick stash-and-pop, manual handling, or cancel.
- **Expected**: For unrelated files (not overlapping the merge's file set), the script should auto-stash with a labeled entry, do the merge, pop, and surface what it did.
- **Workaround**: Used `git stash push -m "devorch-merge-temp" -- <path>`, ran the merge, then `git stash pop`. Worked cleanly but added 2 extra rounds of user interaction the flow could have absorbed.
