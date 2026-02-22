---
description: List, merge, or delete devorch worktrees
model: opus
---

Worktree lifecycle management. Lists active devorch worktrees with their plan and status, then offers merge or delete actions.

## Workflow

### Step 1 — List worktrees

Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON output. The output includes a `mainBranch` field (e.g., "main" or "master") — use this value everywhere `<mainBranch>` appears below.

If count == 0: report "No active worktrees." and stop.

Display a formatted list. Each worktree entry includes a `satellites` array — if non-empty, show satellite repos indented below the worktree:

```
## Active Worktrees

1. **feature-a** (branch: devorch/feature-a)
   Plan: Add Auth System
   Status: Phase 2/4 complete — ready for phase 3
   Satellites:
     - backend (exists)
     - frontend (missing)

2. **api-refactor** (branch: devorch/api-refactor)
   Plan: Refactor API Layer
   Status: Completed (all 3 phases)
```

For each satellite, show `(exists)` or `(missing)` based on the `exists` field in the satellite entry.

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

If the selected worktree has satellites, also show commits from each existing satellite:
```bash
git -C <satellite.repoPath> log --oneline <mainBranch>..<worktreeBranch>
```

Confirm via `AskUserQuestion`: "Merge N commits from `<branch>` into `<mainBranch>`?" (mention satellite repos if present)

**With satellites (coordinated merge)**:

a. **Dry-run all repos first** — For each repo (primary + existing satellites), run:
```bash
git -C <repoMainPath> merge --no-commit --no-ff <worktreeBranch>
git -C <repoMainPath> merge --abort
```
If any dry-run fails: report which repo has conflicts and stop. Do NOT merge any repo.

b. **Merge sequentially** (only if all dry-runs pass) — Primary first, then satellites:
```bash
git checkout <mainBranch>
git merge <worktreeBranch>
```
For each existing satellite:
```bash
git -C <satellite.repoPath> checkout <mainBranch>
git -C <satellite.repoPath> merge <worktreeBranch>
```

c. **Cleanup all repos** — For each repo (primary + existing satellites):
```bash
git worktree remove <worktreePath>
git branch -d <worktreeBranch>
```
For satellites:
```bash
git -C <satellite.repoPath> worktree remove <satellite.worktreePath>
git -C <satellite.repoPath> branch -d <worktreeBranch>
```

Report: "Merged and cleaned up `<name>` across N repos."

**Without satellites** (standard merge):

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

If merge has conflicts: report the conflicting files and repo, and instruct the user to resolve manually. Do NOT force-resolve.

### Step 3b — Delete flow (if "Delete")

If only 1 worktree: use it. If multiple: `AskUserQuestion` to select which one.

If the selected worktree has satellites, mention them in the confirmation: "Delete worktree `<name>` and N satellite worktrees? This will remove branches and all unmerged changes."

Otherwise: "Delete worktree `<name>`? This will remove the branch and all unmerged changes."

Confirm via `AskUserQuestion`.

If confirmed:

**Delete primary worktree**:
```bash
git worktree remove <worktreePath> --force
git branch -D <worktreeBranch>
```

**Delete each existing satellite worktree**:
```bash
git -C <satellite.repoPath> worktree remove <satellite.worktreePath> --force
git -C <satellite.repoPath> branch -D <worktreeBranch>
```

Report: "Deleted worktree `<name>` and branch `<branch>`." (append "Also removed N satellite worktrees." if satellites were deleted)

## Rules

- Do not narrate actions. Execute directly without preamble.
- Never force-merge or auto-resolve conflicts.
- Deletion is destructive (branch -D) — always confirm via AskUserQuestion first.
- After merge or delete, loop back to Step 1 to show updated list and offer another action.
- **Language policy**: User-facing output (questions, reports, summaries, progress messages) in Portuguese pt-BR with correct accentuation (e.g., "não", "ação", "é", "código", "será"). Code, git commits, internal files, and technical documentation in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese text.
