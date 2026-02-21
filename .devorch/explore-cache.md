# Explore Cache
Generated: 2026-02-21T15:36:00Z

## Pipeline Flow & Round-trip Bottlenecks

### Full execution pipeline mapped (talk → build → completion)
- **Talk phase**: ~8 think cycles: map-project → conventions → explore agents → clarify → setup-worktree → validate → commit
- **Build phase (per phase)**: ~6 think cycles: init-phase → explore (if needed) → builders (waves) → check+validation → format-commit → update-state → manage-cache
- **Final verification**: check-project + 1 cross-phase Explore + 3 adversarial reviewers
- **Total for 3-phase build**: ~25-35 Claude think cycles, where ~30-40% is overhead

### Key bottleneck patterns identified
1. **Script proliferation**: 12+ sequential script calls with intermediate Claude thinking between each
2. **Redundant plan parsing**: `plans/current.md` parsed 5 times by different scripts (validate-plan, init-phase, run-validation, format-commit, list-worktrees)
3. **Secondary-repos parsed 3 times**: validate-plan, init-phase, list-worktrees each call `extractSecondaryRepos()`
4. **Conventions re-read per builder**: Each builder reads CONVENTIONS.md independently (~5-10 disk reads per phase)
5. **check-project.ts runs twice**: once per phase, once in final verification
6. **Cross-phase Explore agent redundant**: re-validates code already checked at phase level

## Script Consolidation Opportunities

### Combination targets (high impact)
1. **format-commit.ts + update-state.ts → phase-summary.ts**: Both run after every phase, saves 2 think cycles/phase
2. **check-project.ts + run-validation.ts → phase-check.ts**: Both already run in parallel, consolidate outputs. Saves 1 think cycle/phase
3. **map-project.ts + map-conventions.ts → map-project.ts (enhanced)**: Both scan same dirs, read same package.json
4. **validate-plan.ts absorbed into init-phase.ts (--validate flag)**: Both parse same plan file

### Script call counts per 3-phase build
- init-phase: 3x | check-project: 4x | run-validation: 3x | format-commit: 3x | update-state: 3x | manage-cache: 3x | list-worktrees: 1x | validate-plan: 1x

## Agent Coordination Overhead

### Redundant validation layers
- Phase-level: check-project + run-validation per phase
- Final: check-project AGAIN + cross-phase Explore + 3 adversarial reviewers
- State.md verified by both phase agent AND orchestrator
- TaskList polled after builders already called TaskUpdate

### Context waste per builder
- Full conventions included (~200 lines each time, could be filtered per task)
- State.md included in builder prompts (builders don't need orchestration state)
- Explore-cache sections re-included across phases even if already used

## Quantified Impact Estimates

### Per 3-phase build (typical ~120s)
| Area | Current overhead | Potential savings |
|------|-----------------|-------------------|
| Script think cycles | ~45s | ~20s (combine scripts) |
| Redundant final check | ~30s | ~25s (conditional) |
| File re-reads | ~15s | ~8s (caching) |
| Satellite setup | ~10s | ~8s (parallelize) |

### Token consumption
- Current: ~335KB per 3-phase plan
- Optimized: ~240KB (~28% reduction)
