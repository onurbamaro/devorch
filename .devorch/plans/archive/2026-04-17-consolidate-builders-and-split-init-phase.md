# Plan: Consolidate builders and split init-phase

<description>
Eliminate devorch-builder-spec agent variant (consolidate into devorch-builder-deep to remove ~70% duplicated workflow between them) and split scripts/init-phase.ts (844 lines) into two focused lib modules: scripts/lib/task-filter.ts (per-task convention/cache filtering) and scripts/lib/slice-builder.ts (wave/task parsing and slice assembly). Update commands/devorch.md §F2.4/§F3c dispatch rules and docs/PLAN-FORMAT.md Model/Effort policy to reflect the two-variant world (mech + deep).
</description>

<objective>
After the plan:
1. agents/devorch-builder-spec.md no longer exists; dispatch maps only `sonnet → mech; else → deep`.
2. scripts/init-phase.ts is ≤400 lines and contains only CLI glue, subprocess orchestration, and JSON assembly — all filter/parse logic lives in scripts/lib/task-filter.ts and scripts/lib/slice-builder.ts.
3. CLI contract of init-phase.ts is unchanged (same args, same JSON output shape) — verified by running it against the current plan at every phase end.
4. docs/PLAN-FORMAT.md and commands/devorch.md reflect the two-variant dispatch with no lingering references to devorch-builder-spec.
</objective>

<classification>
Type: refactor
Complexity: medium
Risk: medium
</classification>

<decisions>
- A vs B for builder consolidation → A (eliminate devorch-builder-spec, route spec-closed to deep with xhigh runtime cost)
- Backward compatibility for archived plans referencing devorch-builder-spec → not required (user confirmed; archive inventory found zero hits anyway)
- init-phase.ts split boundary → task-filter.ts (filters) + slice-builder.ts (waves/tasks/slice assembly); subprocess + CLI stays in init-phase.ts
- Shared types location → each lib owns its own exported interfaces; no separate types file
</decisions>

<problem-statement>
Two problems coupled in one plan because they intersect at commands/devorch.md and docs/PLAN-FORMAT.md:

1. agents/devorch-builder-deep.md (92 lines) and agents/devorch-builder-spec.md (84 lines) share roughly 62% of their content (workflow contract-map → spec-first stubs → self-verify → security check → multi-repo → red flags → rules) and already exhibit observable drift: security-check wording diverges, multi-repo section is English in spec and Portuguese in deep, red flags table has 6 vs 7 rows, CONTRACT MAP is mandatory in spec but conditional in deep. Every future edit must be mirrored manually or the two files diverge further.

2. scripts/init-phase.ts is 844 lines and concentrates four distinct responsibilities: convention-per-task filtering, cache-per-task filtering, slice-size gate computation, and subprocess orchestration (map-project, tldr-analyze). The file is the largest mechanical unit in the repo and difficult to navigate or test in isolation.
</problem-statement>

<solution-approach>
**Consolidation (Option A)**: delete agents/devorch-builder-spec.md. commands/devorch.md §F2.4 drops Gate 2 (spec) so the remaining gates are `mech` (strictly mechanical) and `deep` (default). §F3c drops the middle dispatch bullet, leaving `model: sonnet → mech; else → deep`. docs/PLAN-FORMAT.md removes the spec-builder row from § Model/Effort policy. Plans that would previously have used opus+high for spec-closed tasks now run opus+xhigh under devorch-builder-deep; the cost delta is accepted as marginal relative to drift risk and maintenance load.

**Split**: create scripts/lib/task-filter.ts with the pure per-task filter functions (`extractFileRefs`, `extractExtensions`, `filterCacheByRefs`, `parseConventionSections`, `filterConventionsForTask`, `shouldIncludeTesting`, `parseFastPath`) plus the `EXT_KEYWORDS` and `FAST_PATH_WHITELIST` constants. Create scripts/lib/slice-builder.ts with wave/task parsing (`parseWaves`, `parseTasks`), phase-level cache filtering (`filterCache`), and the slice-size gate helper. scripts/init-phase.ts becomes orchestration-only: CLI args → file reads → subprocess calls → per-task assembly loop (delegating to the libs) → JSON output. No caller imports from init-phase.ts (it is a leaf CLI script), so the split is internal and the JSON contract stays identical.

Alternatives considered: (a) Option B — keep both agent files and extract a shared `_builder-core.md` inlined by install.ts. Rejected: adds install-time string interpolation complexity and does not eliminate the frontmatter cost profile, just the duplicated body. The body drift is the observable problem and Option A solves it with zero install complexity. (b) Three-way split of init-phase.ts (filters + slice + orchestration as three libs). Rejected: overfitting; the explorer's analysis showed two natural cohesive groupings with the orchestration reduction happening inside init-phase itself.
</solution-approach>

<relevant-files>
- `agents/devorch-builder-spec.md` — to be deleted
- `agents/devorch-builder-deep.md` — reference for workflow the consolidated agent already covers (CONTRACT MAP conditional, which becomes the unified behavior)
- `agents/devorch-builder-mech.md` — untouched; reference for frontmatter/style
- `scripts/init-phase.ts` — to be slimmed to orchestration only
- `scripts/lib/plan-parser.ts` — style reference; existing sibling lib
- `scripts/lib/fs-utils.ts` — style reference; existing sibling lib
- `scripts/lib/args.ts` — style reference; existing sibling lib
- `scripts/validate-plan.ts` — does NOT validate the `Assigned To` value against an allowlist (confirmed by exploration); no edit needed
- `commands/devorch.md` — §F2.4 (task classification gates) and §F3c (dispatch rules) need spec-variant removal
- `docs/PLAN-FORMAT.md` — § Model/Effort policy and the template task example need spec-variant removal
- `install.ts` — unchanged (variable substitution only; dropping an agent file requires no install-logic change)
- `uninstall.ts` — unchanged (glob-based cleanup `devorch-*` still removes stale spec agents on next uninstall)

<new-files>
- `scripts/lib/task-filter.ts` — per-task convention/cache/extension filters
- `scripts/lib/slice-builder.ts` — wave/task parsing, phase cache filter, slice-size gate helper
</new-files>
</relevant-files>

<phase1 name="Consolidate builders and split init-phase">
<goal>Eliminate devorch-builder-spec, extract filter and slice-building logic from init-phase.ts into two new libs, and update dispatch docs accordingly — all while preserving the init-phase.ts CLI contract.</goal>

<spec>
<interface name="task-filter-exports">
  <input>Module scripts/lib/task-filter.ts must export exactly these symbols:
    - `EXT_KEYWORDS: Record&lt;string, string[]&gt;`
    - `FAST_PATH_WHITELIST: string[]`
    - `interface ConventionSection { header: string; content: string }`
    - `extractFileRefs(text: string): Set&lt;string&gt;`
    - `extractExtensions(text: string): Set&lt;string&gt;`
    - `filterCacheByRefs(cache: string, fileRefs: Set&lt;string&gt;): string`
    - `parseConventionSections(conventionsText: string): ConventionSection[]`
    - `filterConventionsForTask(conventionsText: string, taskExts: Set&lt;string&gt;, planFastPath?: boolean): string[]`
    - `shouldIncludeTesting(taskContent: string, taskRefs: Set&lt;string&gt;): boolean`
    - `parseFastPath(planContent: string): boolean`
  </input>
  <output>Each function preserves the exact behavior and return shape used today in init-phase.ts.</output>
</interface>

<interface name="slice-builder-exports">
  <input>Module scripts/lib/slice-builder.ts must export exactly these symbols:
    - `interface ParsedWave { wave: number; taskIds: string[]; type: "parallel" | "sequential" }`
    - `interface ParsedTask { id: string; assignedTo: string; repo: string; title: string; content: string; model?: string; effort?: string; exemplars: string[]; nonGoals: string }` (match whatever fields the current init-phase parses — if the current code tracks additional fields, include them)
    - `filterCache(cache: string, phaseText: string): string`
    - `parseWaves(phaseText: string): ParsedWave[]`
    - `parseTasks(phaseText: string): Record&lt;string, ParsedTask&gt;`
    - `TOKEN_GATE_UNDER: number` and `TOKEN_GATE_OVER: number` constants (currently 3000 and 30000 — confirm against source)
  </input>
  <output>Each function preserves the exact behavior used today. Slice-gate computation may stay inline in init-phase.ts if it does not cleanly generalize — prefer clarity over symmetry.</output>
</interface>

<behavior name="init-phase-cli-contract">
  <precondition>init-phase.ts is invoked as `bun scripts/init-phase.ts --plan &lt;path&gt; --phase &lt;N&gt; --cache-root &lt;dir&gt; --cache-name &lt;name&gt;` with a valid plan.</precondition>
  <postcondition>JSON output on stdout has the same top-level keys and shape as before the refactor: waves, tasks, sliceWarnings, conventionSectionsByTask, totalPhases, and whatever else the current script emits. Exit code is 0 on success. The `contentFile` side effect (writing the phase content file) still happens at the same path. Running `bun scripts/init-phase.ts --plan &lt;this-plan&gt; --phase 1 --cache-root &lt;mainRoot&gt; --cache-name consolidate-builders-and-split-init-phase` after the refactor must succeed and produce output accepted by the orchestrator.</postcondition>
</behavior>

<behavior name="dispatch-rules-after-removal">
  <precondition>agents/devorch-builder-spec.md has been deleted.</precondition>
  <postcondition>commands/devorch.md §F2.4 contains exactly two classification gates (mech, deep). §F3c contains exactly two dispatch bullets: `model: sonnet → devorch-builder-mech` and `else → devorch-builder-deep`. No string `devorch-builder-spec` appears anywhere in commands/devorch.md or docs/PLAN-FORMAT.md. The escalation rule that mentioned `needs builder-spec` is either removed or rewritten to only reference builder-deep (there is no spec variant to escalate to).</postcondition>
</behavior>

<invariant>Tasks 1 and 2 both run in wave 1 and touch disjoint file sets: task 1 creates scripts/lib/task-filter.ts only (does not modify init-phase.ts); task 2 deletes agents/devorch-builder-spec.md and edits commands/devorch.md + docs/PLAN-FORMAT.md only. Task 3 in wave 2 is the only task that modifies scripts/init-phase.ts.</invariant>

<invariant>scripts/init-phase.ts retains a copy of the extracted filter functions until task 3 runs — do not remove them in task 1. Intermediate state between waves is valid and compilable (init-phase.ts still works from its local copies; task-filter.ts exists as an unused new file).</invariant>
</spec>

<tasks>
#### 1. Create scripts/lib/task-filter.ts
- **ID**: create-task-filter-lib
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: xhigh
- **Spec refs**: task-filter-exports
- **Exemplars**: scripts/lib/plan-parser.ts, scripts/lib/fs-utils.ts
- **Non-goals**: do not modify scripts/init-phase.ts; do not delete anything from it; the file must continue to work from its current inline copies
- Read scripts/init-phase.ts to locate every function listed in the task-filter-exports spec. Current approximate locations (may shift — confirm by reading): `extractFileRefs` ≈ lines 172–183, `filterCacheByRefs` ≈ 185–219, `parseConventionSections` ≈ 234–248, `filterConventionsForTask` + `shouldIncludeTesting` + `parseFastPath` ≈ 250–308, `extractExtensions` ≈ 221–232, `EXT_KEYWORDS` + `FAST_PATH_WHITELIST` constants near the top of the filter block
- Create scripts/lib/task-filter.ts with exactly the exports listed in the spec. Preserve behavior byte-for-byte — copy the logic verbatim, just adding `export` keywords and any necessary imports
- Consolidate the convention-filtering logic: current init-phase.ts may have convention filtering split between a standalone function and inline code in the per-task loop. `filterConventionsForTask(conventionsText, taskExts, planFastPath?)` must encapsulate the full behavior including fast-path gating, returning the array of matching header strings. Confirm the exact behavior by re-reading the per-task loop (~lines 583–619) before you finalize the API
- Match the style of scripts/lib/plan-parser.ts: JSDoc headers, interfaces exported before functions, pure functions only
- No runtime changes: just put the functions in a new file with exports. Do not refactor their internals. Do not optimize, rename internal variables, or reorder parameters

#### 2. Eliminate devorch-builder-spec and update dispatch docs
- **ID**: remove-spec-builder
- **Assigned To**: devorch-builder-mech
- **Model**: sonnet
- **Effort**: high
- **Spec refs**: dispatch-rules-after-removal
- **Non-goals**: do not touch agents/devorch-builder-deep.md or agents/devorch-builder-mech.md; do not edit scripts/; do not edit install.ts or uninstall.ts
- Delete the file agents/devorch-builder-spec.md
- Edit commands/devorch.md:
  - §F2.4 (the Per-task model/effort classification block): delete the "Gate 2 — **spec fully closed?** ..." bullet in its entirety. Renumber the remaining gates so "Gate 3 — **default**" becomes "Gate 2 — **default**". Update the surrounding prose from "three builder variants" / "three gates" to "two builder variants" / "two gates" wherever that count appears in §F2.4
  - §F3c (Dispatch builders block): delete the middle bullet ("`model: opus` + `effort: high` → ... devorch-builder-spec ..."). Keep the remaining two bullets. Also remove or rewrite the escalation rule that mentions `needs builder-spec` so it only references builder-deep — the escalation path from mech should now go directly to deep, and if builder-deep escalates, treat as failure per the 3-attempt retry rule on builder-deep (already in §F3c)
  - Search for any other occurrences of `devorch-builder-spec` or "builder-spec" anywhere in commands/devorch.md and remove them
- Edit docs/PLAN-FORMAT.md:
  - § Model/Effort policy: delete the `devorch-builder-spec` bullet. Update the "Three builder variants" / "three task profiles" wording to "Two builder variants" / "two task profiles". Delete Gate 2 from the numbered list of gates; renumber the remaining gates
  - Template task example (the `#### 2. <Task Name>` block around line 109–115): change the `Assigned To` example value from `devorch-builder-spec` to something that fits the new two-variant world — either repeat `devorch-builder-deep` with a different Effort, or remove the second example entirely. Pick whichever keeps the template clearest
  - Search for any other occurrences of `devorch-builder-spec` and remove or redirect them
- Do NOT edit .devorch/plans/archive/ or any plans under .worktrees/ — plan archives are historical record

#### 3. Create scripts/lib/slice-builder.ts and refactor init-phase.ts
- **ID**: create-slice-builder-and-refactor-init-phase
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: xhigh
- **Spec refs**: slice-builder-exports, init-phase-cli-contract
- **Exemplars**: scripts/lib/plan-parser.ts, scripts/check-project.ts
- **Non-goals**: do not change the CLI flags of init-phase.ts; do not change the JSON output shape; do not refactor the subprocess orchestration (map-project, tldr-analyze invocations); do not optimize — behavior preservation is the goal
- Prereq (assume done by task 1): scripts/lib/task-filter.ts exists with the exports from task-filter-exports. Import from it here
- Create scripts/lib/slice-builder.ts with the exports from slice-builder-exports. Move: phase-level `filterCache` (≈ init-phase.ts lines 122–171), `parseWaves` (≈ 311–338), `parseTasks` (≈ 341–387), and the `TOKEN_GATE_UNDER`/`TOKEN_GATE_OVER` constants. If `ParsedTask` currently has more fields than listed in the spec (e.g., extra metadata the current code tracks), include them — the goal is to preserve today's behavior, not to trim
- Slice-size gate: the per-task token-counting loop (≈ lines 635–682) may stay inline in init-phase.ts if extracting it requires threading too many arguments. Use judgment — if a clean helper like `computeSliceGate(slices, taskId, underThreshold, overThreshold): { tokens: number; direction: "under" | "over" | null }` falls out naturally, put it in slice-builder.ts; otherwise leave it in init-phase.ts and note that in a one-line comment
- Refactor scripts/init-phase.ts:
  - Add `import` lines for the needed exports from scripts/lib/task-filter.ts and scripts/lib/slice-builder.ts at the top
  - Delete every function, constant, and type that now lives in the libs. Do NOT keep a copy — this is the step that eliminates duplication
  - The remaining init-phase.ts should contain: imports, CLI arg parsing, phase validation, context extraction (objective, decisions, solution-approach, phase content, project structure), file I/O (CONVENTIONS.md, cache file, exemplars), subprocess orchestration (map-project and tldr-analyze invocations), per-task assembly loop (now calling lib functions), sliceWarnings aggregation, and JSON output assembly
  - Target line count: 300–400. If you come in well below or above, reconsider — something may have been over-moved or under-moved
- Verify the CLI contract: after refactoring, run `bun scripts/init-phase.ts --plan .devorch/plans/consolidate-builders-and-split-init-phase.md --phase 1 --cache-root &lt;mainRoot&gt; --cache-name consolidate-builders-and-split-init-phase` from the worktree root. The JSON output must parse and have the same top-level keys as before. If you cannot run this (cache-root path uncertain), at minimum typecheck the result with `bun --bun tsc --noEmit scripts/init-phase.ts scripts/lib/task-filter.ts scripts/lib/slice-builder.ts` or equivalent
- Do not touch scripts/init-phase.ts's JSON output ordering or any field name — downstream orchestration parses by key, but some keys may be expected in order by the orchestrator; preserve the existing emission pattern
</tasks>

<execution>
**Wave 1** (parallel): create-task-filter-lib, remove-spec-builder
**Wave 2** (after wave 1): create-slice-builder-and-refactor-init-phase
</execution>

<criteria>
- [ ] agents/devorch-builder-spec.md no longer exists
- [ ] `grep -r "devorch-builder-spec" commands/ docs/ agents/ scripts/` returns zero matches (archive/ and .worktrees/ excluded)
- [ ] scripts/lib/task-filter.ts exists and exports every symbol in the task-filter-exports spec
- [ ] scripts/lib/slice-builder.ts exists and exports every symbol in the slice-builder-exports spec
- [ ] scripts/init-phase.ts is ≤400 lines and imports from both new libs
- [ ] `bun scripts/init-phase.ts --plan .devorch/plans/consolidate-builders-and-split-init-phase.md --phase 1 --cache-root <mainRoot> --cache-name consolidate-builders-and-split-init-phase` runs successfully and produces JSON with the same top-level keys as before the refactor
- [ ] Typecheck passes (no duplicate symbol errors, no missing imports)
- [ ] commands/devorch.md §F2.4 shows two gates (mech, deep); §F3c shows two dispatch bullets
- [ ] docs/PLAN-FORMAT.md § Model/Effort policy lists two variants
</criteria>

</phase1>
