# merge-worktree archival commit fails when .devorch is gitignored

**Timestamp**: 2026-04-27
**Severity**: gap

## Prompt
/devorch "in merge-worktree.ts archival stage, detect whether the .devorch directory is gitignored in the target repo. If yes, skip the archival git-add/commit (the archive move on disk is enough, since the directory is ignored anyway). Currently the script tries to commit the archive move and fails with 'paths are ignored by one of your .gitignore files', leaving a staged deletion of the active plan in the working tree that the orchestrator has to clean up by hand."

## Context

- **Where**: Step 13 (merge), `merge-worktree.ts` archival sub-step.
- **What happened**: After successfully merging and archiving the plan to `.devorch/plans/archive/<date>-<name>.md`, the script attempted `git add` on the archive paths. `.devorch` is in this project's `.gitignore`, so the add failed and the archival commit was skipped. The output reported `archivalCommit: null` AND printed an error line `Archival stage failed: ... paths are ignored`. The active plan deletion ended up staged but uncommitted, so the orchestrator had to run a manual `chore(devorch): clean up active plan after merge archival` commit to make the working tree match its log.
- **Expected**: Detect `.gitignore` on the target dir; if ignored, skip the archival commit entirely and surface `archivalCommit: skipped (gitignored)` in the JSON. No leftover staged deletion in the working tree.
- **Workaround**: Manual `git add <path> && git commit -m "..."` from orchestrator.
