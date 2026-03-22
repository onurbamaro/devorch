# Explore Cache
Generated: 2026-03-22T10:00:00Z

## Native Worktree vs devorch Worktree

### Native `isolation: "worktree"` (Agent tool parameter)
- Creates worktrees in `.claude/worktrees/` with auto-generated branch names
- Auto-cleanup if agent makes no changes; worktree path + branch returned if changes exist
- No auto-merge — changes stay on the worktree branch
- No control over branch naming, path, or checkout scope
- Designed for ephemeral, single-agent isolation
- Each agent gets its own worktree — no sharing between agents

### Native `EnterWorktree` / `ExitWorktree` (tools)
- Interactive session-level worktree — switches the entire session's CWD
- Creates worktrees in `.claude/worktrees/` with optional name parameter
- On exit: "keep" (preserves worktree+branch) or "remove" (deletes both)
- Only operates on worktrees created by EnterWorktree in the SAME session
- Cannot control branch name format (auto-generates `worktree-<name>`)

### devorch's `setup-worktree.ts`
- Creates worktrees in `.worktrees/` with named branches (`devorch/<name>`)
- Satellite repo support (secondary repos get parallel worktrees)
- Sparse checkout support (`--sparse-paths`)
- Copies uncommitted `.devorch/` files to worktree (excluding explore-cache)
- Persistent across sessions — designed for multi-session workflows
- Coordinated merge with dry-run, stash management, satellite coordination

### Comparison verdict
Native worktree features are a SUBSET of what devorch needs. Missing: named branches, satellites, sparse checkout, .devorch copying, coordinated merge. Native worktree is designed for ephemeral single-agent work; devorch needs persistent multi-agent orchestration.

For builder-level isolation, `isolation: "worktree"` could provide extra safety per builder, but adds ~2-5s setup overhead per builder + merge complexity for N branches → 1. Current wave system already prevents conflicts by design.

## Current Plan Flow Analysis

### talk flow (sequential bottlenecks)
1. map-project.ts (~2s) → 2. CONVENTIONS check → 3. Explore agents (parallel, ~30-60s) → 4. User Q&A (variable) → 5. Deep explore (conditional) → 6. Design → 7. setup-worktree.ts (~3-5s) → 8. Write plan → 9. Validate → 10. Commit → 11. Report
- User Q&A is the natural bottleneck — cannot optimize
- map-project + CONVENTIONS could overlap with explore prep
- Worktree setup + plan write + validate + commit: ~10-15s total ceremony

### build flow (per-phase overhead)
Per phase: init-phase.ts (~2s) → explore (conditional, ~30s) → builders (parallel, main work) → check-project --quick (~10s) → phase-summary.ts (~2s) → manage-cache.ts (~1s)
- Already overlaps check-project with next phase init
- Per-phase overhead: ~15-17s (excluding builders)
- 2-phase plan: ~30-35s overhead on top of builder work
- 4-phase plan: ~60-70s overhead on top of builder work

### "old plan" friction points
- `explore-cache.md` in main repo is shared across all plans — new talk overwrites previous plan's cache
- Legacy `current.md` in main repo triggers archive migration
- `state.md` mismatch detection adds conditional logic
- Plan naming collision: two plans with similar names could conflict on branch naming

## Inline Build Feasibility (≤2 phases in talk)

### Context budget with 1M tokens
- talk exploration: ~20-30K tokens
- User Q&A: ~5-10K
- Plan generation: ~10-15K
- Builder execution (2 phases × ~3 tasks): builders run in isolated Task agents — zero orchestrator tokens
- Verification (3 reviewers): ~30-50K via isolated agents
- Total orchestrator context: ~100-150K — well within 1M

### What gets eliminated
- Worktree setup overhead (~5s)
- /clear between talk and build (context rebuild ~10s)
- Build startup (plan resolution, state detection ~5s)
- Post-build merge ceremony (~10-20s)
- Total savings: ~30-40s + context rebuild cost

### Open design questions
- Where do builders commit if no worktree? Options: feature branch in main repo, EnterWorktree, or per-builder isolation
- Does inline build violate Principle 2 (fresh context)? Builders still get fresh isolated contexts — orchestrator accumulates coordination overhead only, which is acceptable
- How to handle inline build failure? No worktree to "keep" — changes are on a branch in main repo

## Parallelism Opportunities

### talk parallelism
- map-project.ts + CONVENTIONS.md check: could run in parallel (both are input for explore)
- Explore agents: already parallel (2-3 agents)
- Plan write + validate: could be a single script call
- Current bottleneck: sequential Q&A rounds (by design — each round informs the next)

### build parallelism
- Builders in waves: already parallel
- Check-project + next phase init: already overlapped
- Phase summary + cache management: could run in parallel
- Cross-phase: fundamentally sequential (by design — each phase depends on previous)

### New opportunity with inline build
- Plan generation + EnterWorktree: could overlap
- Final verification reviewers: already parallel (3 agents)
- Merge + cleanup: could be a single script call
