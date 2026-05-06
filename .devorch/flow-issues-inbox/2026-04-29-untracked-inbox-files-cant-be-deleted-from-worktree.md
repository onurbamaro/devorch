# Untracked inbox files cannot be deleted from worktree branch

**Timestamp**: 2026-04-29
**Severity**: gap

## Prompt to fix

```
/devorch "When the orchestrator's plan includes 'each task removes its inbox file(s) in the same commit', untracked files in <mainRoot>/.devorch/flow-issues-inbox/ never reach the worktree (worktree starts from HEAD; untracked files don't propagate). Today the orchestrator must manually 'git add .devorch/flow-issues-inbox/ && git commit -m chore: stage flow-issues inbox' on mainRoot BEFORE running setup-worktree.ts — otherwise builders cannot delete files that don't exist in their working tree. setup-worktree.ts could accept --stage-pending-inbox or the orchestrator instructions in commands/devorch.md Step 2 could codify this pre-commit step explicitly."
```

## Context

- **Where**: Step 2 (worktree creation), every devorch run that intends to drain the inbox.
- **What happened**: Plan A's spec said "Each task removes its corresponding inbox file(s) in the same commit". 25 inbox files existed as untracked WIP in mainRoot. Without a pre-commit on master, the worktree (created from HEAD) had zero inbox files, so builders deleting `.devorch/flow-issues-inbox/<file>.md` in their commits would be deleting nothing. The orchestrator manually ran `git add .devorch/flow-issues-inbox/ && git commit -m "chore(devorch): stage flow-issues inbox for Plan A"` before invoking setup-worktree.
- **Expected**: One of (a) `setup-worktree.ts --stage-pending-inbox` flag that auto-commits any untracked `.devorch/flow-issues-inbox/*.md` on mainRoot before forking the worktree, (b) orchestrator instructions in Step 2 that codify the pre-commit pattern, or (c) the Step 7 plan-write step warns when the plan declares inbox-file-deletions but the inbox files are untracked in mainRoot.
- **Workaround**: orchestrator manually pre-committed. Worked but was an unscripted improvisation — a fresh orchestrator might miss the step and silently produce a "successful" build with the inbox still full in mainRoot.
- **Frequency**: every devorch run that touches the inbox. Guaranteed-friction every time, not a fluke.
