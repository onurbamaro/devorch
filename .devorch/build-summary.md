# Build Summary: Always-Worktree Architecture + Smart Check Feedback
Completed: 2026-02-18T20:11:32.314Z

## Objective
Every `/devorch:make-plan` creates a worktree — no plans live in main's `current.md`. Build auto-detects the target worktree. Check-implementation fixes trivial issues inline, asks for clarification on ambiguous ones, and suggests make-plan for complex ones. A new `/devorch:worktrees` command provides full worktree lifecycle management.

## Key Decisions
- Check feedback model → Three-tier: trivial = fix inline automatically, ambiguous = AskUserQuestion then fix, complex = deliver ready-to-paste /devorch:make-plan prompt with detailed description
- Inline fix execution → Execute directly in build context (check-implementation runs inline in build.md), no Task agent needed
- Explore-cache location → Only in main repo (read-only for worktrees). Invalidation only happens on main when worktree merges.
- current.md in main → Eliminated. Plans always live in worktrees. Legacy current.md auto-archived on first run.
- Build without --plan → Auto-detect: 1 worktree = use it, 2+ = list and ask, 0 = error
- /devorch:worktrees → Full command: list + merge + delete

## New Files
- `scripts/list-worktrees.ts` — lists all worktrees with plan name, branch, build status
- `commands/worktrees.md` — list/merge/delete worktrees command

## Modified Files
- `scripts/init-phase.ts` — add --cache-root flag for reading explore-cache from main repo
- `scripts/manage-cache.ts` — add --root flag for operating on cache at a different root
- `scripts/setup-worktree.ts` — stop copying explore-cache.md to worktree
- `commands/make-plan.md` — remove non-worktree paths, always create worktree
- `commands/build.md` — auto-detect worktree, pass mainRoot to phase agents
- `templates/build-phase.md` — use mainRoot for all cache operations
- `commands/check-implementation.md` — three-tier feedback loop with inline execution

## Phase History
### Phase 1: Script Infrastructure — Add cache-root awareness to init-phase.ts and manage-cache.ts, create list-worktrees.ts, and stop setup-worktree.ts from copying explore-cache.
Script infrastructure complete: init-phase.ts accepts --cache-root for worktree cache reads, manage-cache.ts accepts --root for remote cache operations, list-worktrees.ts created for worktree inventory, setup-worktree.ts excludes explore-cache from worktree copies.

### Phase 2: Always-Worktree Commands — Update make-plan.md, build.md, and build-phase.md to use always-worktree architecture — plans always live in worktrees, cache always reads from main.
Always-worktree commands complete: make-plan.md removes all non-worktree paths and auto-archives legacy current.md, build.md auto-detects worktrees via list-worktrees.ts and passes mainRoot to phase agents, build-phase.md routes cache reads/writes through mainRoot.

### Phase 3: Smart Check Feedback + Worktrees Command — Rewrite check-implementation.md with three-tier feedback (auto-fix trivial, ask ambiguous, suggest make-plan for complex) and create the /devorch:worktrees management command.
(no summary available)

## Commits
343a40a feat(worktrees): add worktree lifecycle management command
73dca69 feat(check): three-tier smart dispatch for issue resolution
ed3ca49 fix(devorch): remove stale worktreeMode and isWorktree references
0a6153b feat(devorch): mainRoot cache paths in build-phase.md
3cc1dd3 feat(devorch): auto-detect worktree in build.md
0499194 feat(devorch): always-worktree make-plan — remove non-worktree paths
4ba89c6 feat(scripts): exclude explore-cache from worktree copy in setup-worktree.ts
0651f8e feat(scripts): create list-worktrees.ts for worktree inventory
96cadf6 feat(scripts): add --root flag to manage-cache.ts
5c73332 feat(scripts): add --cache-root flag to init-phase.ts
dea608b chore(devorch): plan — Always-Worktree Architecture + Smart Check Feedback
cf6f550 feat(build): short worktree names and merge step
3c27bbb feat(worktree): parallel plan execution via git worktrees
f5ff562 fix(check): eliminate redundant verification, fix nested agent failures
5cdcdb5 phase(3): integrate CLI scripts into orchestration files, add generate-summary.ts
34ac467 feat(scripts): add verify-build, run-validation, manage-cache, archive-plan, format-commit
deb2bcf feat(scripts): create init-phase, update-state, extract-waves core CLI scripts
28b5248 chore(devorch): plan — CLI-First Orchestration — Full Deterministic Coverage
