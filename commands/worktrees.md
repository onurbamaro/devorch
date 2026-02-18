---
description: List, merge, or delete devorch worktrees
model: opus
---

Worktree lifecycle management. Lists active devorch worktrees with their plan and status, then offers merge or delete actions.

## Workflow

### Step 1 — List worktrees

Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON output.

If count == 0: report "No active worktrees." and stop.

Display a formatted list:

```
## Active Worktrees

1. **feature-a** (branch: devorch/feature-a)
   Plan: Add Auth System
   Status: Phase 2/4 complete — ready for phase 3

2. **api-refactor** (branch: devorch/api-refactor)
   Plan: Refactor API Layer
   Status: Completed (all 3 phases)
```

### Step 2 — Ask action

Use `AskUserQuestion` with options:
- **"Merge a worktree"** — merge a completed worktree into main
- **"Delete a worktree"** — remove an abandoned worktree (branch + directory)
- **"Done"** — exit

### Step 3a — Merge flow (if "Merge")

If only 1 worktree: use it. If multiple: `AskUserQuestion` to select which one.

Show what will be merged:
```bash
git log --oneline <mainBranch>..<worktreeBranch>
```

Confirm via `AskUserQuestion`: "Merge N commits from `<branch>` into `<mainBranch>`?"

If confirmed:
```bash
git checkout <mainBranch>
git merge <worktreeBranch>
```

If merge succeeds:
```bash
git worktree remove <worktreePath>
git branch -d <worktreeBranch>
```
Report: "Merged and cleaned up `<name>`."

If merge has conflicts: report the conflicting files and instruct the user to resolve manually. Do NOT force-resolve.

### Step 3b — Delete flow (if "Delete")

If only 1 worktree: use it. If multiple: `AskUserQuestion` to select which one.

Confirm via `AskUserQuestion`: "Delete worktree `<name>`? This will remove the branch and all unmerged changes."

If confirmed:
```bash
git worktree remove <worktreePath> --force
git branch -D <worktreeBranch>
```
Report: "Deleted worktree `<name>` and branch `<branch>`."

## Rules

- Do not narrate actions. Execute directly without preamble.
- Never force-merge or auto-resolve conflicts.
- Deletion is destructive (branch -D) — always confirm via AskUserQuestion first.
- After merge or delete, loop back to Step 1 to show updated list and offer another action.
