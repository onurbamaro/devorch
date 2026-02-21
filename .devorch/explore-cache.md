# Explore Cache
Generated: 2026-02-21T01:57:30Z

## State Management Architecture
- `state.md` tracks 3 fields: plan title, last completed phase number, status + phase summary
- Written once per phase (end of phase, after validation + commit)
- Read at: (1) build start for resumption, (2) phase init for builder context, (3) worktree list for status display
- `state-history.md` is deprecated — removed in v2 refactor
- Total state system: ~100 LOC across update-state.ts + consumers

## Core Value vs State Complexity
- devorch's core value: decompose tasks → parallel waves → validate per-phase → adversarial review
- State management is ~10% of system complexity
- State enables one feature: cross-session resumption (resume from phase N+1 after interruption)
- Git commits already encode phase info via `format-commit.ts` (format: `phase(N): summary`)
- Alternative: derive last completed phase from `git log --oneline | grep "phase("` — no state.md needed
- Trade-off: state.md is faster to read (~1ms vs ~100ms git log scan), but adds a file + script to maintain

## Key Tension
- Explorer 1 assessment: state.md is essential (enables resumption, prevents stale state, worktree visibility)
- Explorer 2 assessment: state.md is optional (git log already encodes everything, could remove ~100 LOC)
- Agreement: the state data itself is needed; the question is whether a dedicated file é o mecanismo certo vs git-native tracking
