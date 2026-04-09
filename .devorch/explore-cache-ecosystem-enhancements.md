# Explore Cache
Generated: 2026-04-09T14:00:00Z

## Scripts Architecture & Data Flow

### init-phase.ts
- Compound context generator: loads plan, conventions, explore-cache, specs, project-map per phase
- Output JSON: `{ phaseNumber, phaseName, totalPhases, planTitle, waves, tasks, conventionsByTask, cacheByTask, specsByTask, content/contentFile }`
- Cache filtering: reads `explore-cache-<name>.md`, splits by `## Header` sections, matches by backtick-extracted file refs (case-insensitive string inclusion)
- Convention filtering: by file extension → keyword match (`.ts` matches "typescript", "async")
- Spec filtering: if task has `**Spec refs**`, uses `filterSpecsByRefs()`; else full spec section
- Calls `map-project.ts` subprocess if `.devorch/project-map.md` stale (>5min)

### map-project.ts
- Filesystem-only analysis: lock files, directory tree (2 levels), package.json deps/scripts, git log, sibling repos
- No AST analysis, no code parsing — only structure and metadata
- Output: ~80-line markdown string to stdout
- With `--persist`: writes `.devorch/project-map.md`

### plan-parser.ts (lib)
- Shared library: `readPlan()`, `extractPlanTitle()`, `parsePhaseBounds()`, `extractTagContent()`, `extractPhaseSpec()`, `parseSpecNames()`, `filterSpecsByRefs()`
- Spec types: interface, error-contract, behavior, invariant, endpoint
- Named specs via `name="..."` attrs; implicit names for invariants (invariant-1, invariant-2) and endpoints (METHOD-/path)

### check-project.ts
- Runs lint, typecheck, build, test in parallel
- Output JSON: `{ lint, typecheck, build, test }` each "pass" | "skip" | "fail: <msg>"
- `--quick`: only build + typecheck, 10s timeout
- Auto-detects package manager via lock file sniffing

### manage-cache.ts
- Invalidates sections containing git-changed files
- Trims to `--max-lines` (default 5000) by removing oldest sections
- `--cache-name` for per-plan isolation
- Output JSON: `{ action, sectionsRemoved, sectionsRemaining, linesAfter }`

## Build Pipeline & Failure Handling

### build.md — Phase Loop
- Phases sequential, waves parallel within phase
- Builder selection: `task.effort == "high"` → devorch-builder-deep, else devorch-builder
- Model override via `task.model`
- Each builder prompt includes: Objective, Solution Approach, Decisions, task details, filtered conventions, filtered cache, filtered specs

### Current Failure Handling (build.md lines 107-109)
- Post-wave: check `TaskList` for `status: "completed"` + `git log` for matching commit
- **First failure**: diagnose via Task result output, re-launch with failure context note, increment retry counter
- **After 1 retry**: stop and report failure — no further retries
- No configurable retry budget in plan
- No structured error taxonomy
- No escalation beyond stopping

### Builder Behavior (devorch-builder.md)
- Zero-tolerance: responsible for zero lint/typecheck/build errors including pre-existing
- Cannot fix → block task, mark `in_progress`, report blocker
- TaskUpdate(status: "completed") mandatory as last action — missing it stalls pipeline
- No self-fix loop — builders report blockers, orchestrator diagnoses

### Feedback Logging
- Append-only to `.devorch/feedback.md`
- Triggers: builder failure, check failure, merge conflicts, worktree issues, blockers
- Format: ISO date, phase, category, what happened, workaround, suggestion

## Talk Pipeline & Review System

### Talk Workflow
- Step 2: Directed exploration — 2-3 Explore agents with specific focuses (not open-ended)
- Step 3: Mandatory multi-round clarification — up to 4 questions per round, no cap on rounds
- Step 3b: Spec proposal — displayed as text, user confirms/adjusts/rejects
- Step 5: Plan proposal with routing options (inline vs worktree)
- Step 6: Solution design — deep thinking, alternatives, risks

### validate-plan.ts
- Checks structure/form: required tags, sequential phase numbering, required per-phase sections
- Checks spec quality: interface names + input + output, error-contracts ≥1 case, behaviors with pre/postconditions
- Checks wave conflicts: warns if tasks in same wave touch same file
- Checks spec uniqueness and spec-task integrity
- Does NOT check: plan feasibility, design correctness, architectural flaws, cross-phase consistency

### Adversarial Review (post-build only, Step 9i)
- Scaled by task count: 1-2 tasks → 1 reviewer, 3-5 → 2, 6+ → 3
- Mandates: security, quality, completeness + cross-phase integration
- Findings triaged: trivial → inline fix, fix-level → builder-deep, talk-level → reported as pending

### GAP: No Pre-Execution Plan Challenge
- Between Step 6 (design) and Step 7 (create plan): NO adversarial review of plan content
- validate-plan.ts checks form, not correctness
- No agent challenges approach, risk assessment, task decomposition, or spec completeness
- Optimal insertion point: after Step 6, before Step 7
