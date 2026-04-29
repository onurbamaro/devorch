# `.devorch/` gitignored in user repo blocks plan commit silently

**Timestamp**: 2026-04-28
**Severity**: nit

## Prompt to fix

```
/devorch "in agents/devorch.md Step 8.2 (commit the plan), detect when .devorch/ is gitignored and either (a) automatically use 'git add -f' for plan + GOTCHAS files since they're devorch's intended artifacts, or (b) emit a clear one-line note that the plan stays on disk only and skip the commit. Today the commit silently fails with 'paths are ignored by .gitignore' and the orchestrator must improvise."
```

## Context

- **Where**: Step 8.2 — committing `.devorch/plans/<name>.md` + `.devorch/GOTCHAS.md` after validation.
- **What happened**: `git add .devorch/plans/cancellations-tab.md .devorch/GOTCHAS.md` returned "paths are ignored by one of your .gitignore files" because the rastreia-reports repo gitignores `.devorch/` (presumably to keep cache/state files out of git). The orchestrator instructions assume the commit succeeds; nothing in Step 8 tells the LLM what to do when the user's repo gitignores devorch's artifact directory. I had to improvise: skip the plan commit, accept that the plan lives only on the worktree filesystem, and use `git add -f` later for the GOTCHAS file.
- **Expected**: Either the script handles this transparently (auto-`-f` for known devorch artifacts) or the orchestrator instructions document the fallback.
- **Workaround**: Skipped the plan commit. Used `git add -f .devorch/GOTCHAS.md` for the gotcha capture step. The plan still works because `init-phase.ts` reads from disk, not git.
- **Why it matters**: subtle context-decision tax. The first time a user gitignores `.devorch/`, the orchestrator improvises (correctly, here). But the choice should be in the manual, not invented per-session.
