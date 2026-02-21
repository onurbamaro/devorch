# Explore Cache
Generated: 2026-02-21T17:57:00Z

## Current Merge Section (Section 4 of build.md)
The merge step runs in the **orchestrator context** (build.md), not delegated to builders. It:
1. Detects worktree branch + main branch
2. Detects satellites from plan file `<secondary-repos>`
3. Asks user: "Merge now" or "Keep worktree"
4. If merge with satellites: dry-run ALL repos first (atomic check), then merge sequentially, then cleanup
5. If merge without satellites: checkout → merge → worktree remove → branch delete
6. **Assumes working tree is clean** in all repos — no handling for uncommitted changes

Key variables: `<projectRoot>`, `<mainBranch>`, `<worktreeBranch>`, `<repoMainPath>`, `<worktreePath>`

## Git Stash Edge Cases
Critical findings for the stash+merge workflow:

1. **--ours/--theirs is INVERTED after stash pop** — after `git stash pop` conflicts:
   - `--ours` = HEAD (post-merge state, i.e. the worktree branch changes merged in)
   - `--theirs` = stashed changes (pre-merge local modifications)
   - The user's original proposal had this backwards

2. **Stash pop auto-drops on success, keeps entry on failure** — must track whether to drop manually

3. **`git stash push` with no tracked changes** = "No local changes to save" (exit 0, no entry created). Must filter `git status --porcelain` to exclude `??` lines before deciding to stash.

4. **After failed stash pop**: repo is in merge-conflict state with conflict markers. NOT a clean state.

5. **Don't use --include-untracked** — risks stashing build artifacts, node_modules. Filter status output instead.

6. **Merge fails after stash**: need to `merge --abort` then `stash pop` to restore state.

7. **Multi-repo coordination**: stash/dry-run/merge/pop must be coordinated across primary + satellites.

## Style Patterns for build.md
- Top-level sections: `### N. Section Name`
- Sub-steps: numbered lists (1., 2., a., b., c.)
- Single commands: inline backticks. Multi-line sequences: ```bash code blocks
- Conditionals: English prose "If X: do Y"
- Error handling: "report error and stop", "verify X, if not Y"
- Imperative verbs: "Run", "Parse", "Check", "Detect", "Report"
- Variables: angle brackets `<varName>` for runtime values
- Merge section is orchestrator-context (uses AskUserQuestion, git commands directly)
