# Parallel builder shared-worktree typecheck flake — confirmed

**Timestamp**: 2026-04-29
**Severity**: nit

## Prompt to fix

Already covered by the existing `validate-plan` warning ("Builders share a worktree — typecheck/lint may surface contention from concurrent WIP"). This file just confirms the prediction with a real observation; no new action needed beyond watching whether the builder retry rate stays acceptable as parallel-wave plans become more common.

## Context

- **Where**: Phase 2 Wave 1 of Plan A (4 parallel builders on the same worktree).
- **What happened**: Builder for `merge-setup-satellite-path-validation` reported in its build report: "first `check-project.ts ... --quick` invocation reported `typecheck: fail: exit code 2` with no stderr captured; a direct `bunx tsc --noEmit` from the same cwd returned exit 0, and re-running check-project also returned `pass`. Possible transient interaction with parallel-builder file activity. Not blocking."
- **Why this is signal**: validate-plan emitted the exact warning before this phase ran ("Phase 2: Wave 1 has 4 tasks targeting Repo 'primary' with disjoint files: [...]. Builders share a worktree — typecheck/lint may surface contention from concurrent WIP."). The builder's auto-retry absorbed the flake; production impact zero.
- **Implication**: the same-repo-disjoint-files parallel-wave path is real but cheap — retry handles it. If the flake rate climbs (e.g., with 6+ parallel builders or longer typecheck times), revisit serializing same-repo same-wave by default vs. opt-in.
- **Workaround**: none needed — builder retry covered it transparently.
