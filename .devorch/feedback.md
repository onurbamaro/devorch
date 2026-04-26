
### 2026-04-12 — merge-worktree.ts selfBuild detection fails post-merge
- **Phase**: merge
- **Category**: blocker
- **What happened**: merge-worktree.ts uses `git diff --name-only ${originalBranch}..HEAD` to detect self-build need, but after checkout+merge, HEAD IS originalBranch, so the diff is empty. selfBuildNeeded was incorrectly false despite scripts/commands changing.
- **Workaround**: Manual `bun run install` after merge completed.
- **Suggestion**: Compare against the pre-merge commit hash instead of `originalBranch..HEAD`. Save the pre-merge HEAD hash before checkout, then diff against that.

### 2026-04-12 — merge-worktree.ts git ENOENT during worktree removal
- **Phase**: merge
- **Category**: blocker
- **What happened**: Bun.spawnSync(["git", ...]) threw ENOENT during removeWorktree step, despite git being available throughout the rest of the script execution. The worktree was already removed by the time manual cleanup ran.
- **Workaround**: Manual `git branch -d` after script failed. Worktree dir was already gone.
- **Suggestion**: Add retry logic for the worktree removal step, or use absolute path to git binary.
