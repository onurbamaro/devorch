# Plan: Evolve devorch — quality levers, wider waves, tactical fixes

<description>
Evolve devorch with three coordinated improvements: (1) tactical bug fixes for builder TaskUpdate mandate and `\bspec\b` regex over-match on "Spec refs:" label; (2) new quality levers via optional `**Exemplars**` + `**Non-goals**` task fields injected into builder prompts; (3) stronger planner guidance for spec density, wider waves (4-5 tasks default), and phase consolidation to reduce per-phase overhead.
</description>

<objective>
After this plan: (a) builders no longer receive the TaskUpdate mandate; orchestrator owns completion signal via its own TaskUpdate calls post-Agent-return. (b) `shouldIncludeTesting` in init-phase.ts strips the `**Spec refs**:` label before applying the `\bspec\b` regex. (c) Plan format supports optional `**Exemplars**` and `**Non-goals**` task fields; init-phase.ts emits `exemplarsByTask` + `nonGoalsByTask`; validate-plan.ts accepts them; both build.md and talk.md inject them into builder prompts in a fixed section order. (d) talk.md planner guidance biases toward 4-5 tasks per wave, fewer phases via consolidation, and ≥1 spec contract per substantive task.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: medium
</classification>

<decisions>
- Scope selected → Bugs #2+#3, Spec density/exemplars/non-goals, Wider waves default, Cross-phase parallelism
- Builder workflow appetite → Minimal: only remove TaskUpdate mandate. No pre-computed stubs, no TDD flag.
- Cross-phase parallelism interpretation → Reframed as phase consolidation + wider waves guidance (no literal parallel-phase execution runtime change).
- Success metric → Zero DA findings in simple sessions + reduced review findings (qualitative observation).
- DA refinements → Accept refined specs (sanitization regex, empty defaults, fixed section order, explicit orchestrator TaskUpdate flow) and proceed.
</decisions>

<problem-statement>
Current devorch builder prompt requires a `TaskUpdate` call that is unavailable in subagent contexts, causing pipeline stalls and log noise. The `\bspec\b` regex in `shouldIncludeTesting` triggers on the `**Spec refs**:` metadata label, over-including `## Testing` conventions for unrelated tasks. Additionally, plan quality is under-leveraged: builders get conventions + cache + specs but no explicit file exemplars ("follow pattern in X") nor non-goals ("do NOT touch Y"). Planner bias toward narrow 2-3 task waves and many small phases adds per-phase overhead (~2-3 min each) without quality benefit.
</problem-statement>

<solution-approach>
Three coordinated changes landed in a single phase across 2 waves:

**Wave 1 (parallel, different files)**: foundational edits that define the new contracts — remove TaskUpdate mandate from agent markdown, update init-phase.ts parser (sanitize spec regex + parse new fields), teach validate-plan.ts the new optional fields. No file overlap across T1/T2/T3.

**Wave 2 (parallel, depends on Wave 1 contracts)**: consume the new contracts in command files — build.md (build path) and talk.md (talk path including INLINE PATH builder dispatch). T4 edits build.md, T5 edits talk.md. Both inject `## Exemplars` + `## Non-goals` sections into builder prompts using a fixed section order, and swap the TaskUpdate mandate for an orchestrator-side `TaskUpdate` call after each Agent return. T5 also lands the planner guidance changes (spec density, wider waves, phase consolidation).

Alternatives considered:
- Literal cross-phase parallel execution → rejected. Phases exist because of handoff dependencies. Independent phases should be merged (sizing change covers this).
- Pre-computed stubs (planner writes type signatures, builder fills bodies) → rejected. Rigid, limits builder judgment.
- TDD builder flag → rejected. Adds 30% time, marginal quality gain over existing spec-first stubs workflow.

Risks and mitigations:
- Backward compat: plans without new fields must still work → validate-plan accepts absence; init-phase emits empty defaults (never missing keys).
- Orphan red-flag row after removing step 9 from agents → T1 removes BOTH the step and the red-flag row in the same edit.
- Section ordering drift between build.md and talk.md → T4 and T5 both pin the same order per spec invariant.
</solution-approach>

<relevant-files>
- `agents/devorch-builder.md` — T1: remove TaskUpdate step + red-flag row
- `agents/devorch-builder-deep.md` — T1: same edits
- `scripts/init-phase.ts` — T2: sanitize spec regex, parse new fields, emit new JSON keys
- `scripts/validate-plan.ts` — T3: accept Exemplars + Non-goals optional fields
- `commands/build.md` — T4: swap TaskUpdate mandate for orchestrator-side call; inject new sections into builder prompt
- `commands/talk.md` — T5: same as T4 for INLINE PATH; Plan Format docs; planner guidance (spec density, wider waves, phase consolidation)
</relevant-files>

<phase1 name="Evolve devorch">
<goal>Ship tactical fixes + quality levers + planner guidance in one phase across 2 waves.</goal>

<spec>
<behavior name="no-taskupdate-mandate">
  <precondition>agents/devorch-builder.md and agents/devorch-builder-deep.md contain step 9 instructing TaskUpdate call and a red-flag row referencing "Vou pular o TaskUpdate"</precondition>
  <postcondition>both files have step 9 removed (subsequent steps renumbered), and the red-flag row referencing TaskUpdate is removed. No occurrences of "TaskUpdate" remain in either file.</postcondition>
</behavior>

<behavior name="sanitize-spec-regex">
  <precondition>shouldIncludeTesting in scripts/init-phase.ts applies `\btest\b|\bspec\b` directly to taskContent, causing over-match on "**Spec refs**:" label</precondition>
  <postcondition>shouldIncludeTesting first applies `taskContent.replace(/^\s*\*\*Spec refs\*\*:.*$/gmi, "")` then tests the sanitized string against the existing regex. Task with `**Spec refs**: foo-spec` and no other test/spec mention returns false.</postcondition>
</behavior>

<interface name="parseTaskFields-exemplars-nongoals">
  <input>task content string (may contain `**Exemplars**: path1, path2` and/or `**Non-goals**: free text`)</input>
  <output>extracted `exemplars: string[]` (comma-split, trimmed, empty array when field absent) and `nonGoals: string` (trimmed line content, empty string when field absent)</output>
  <error case="missing-fields">return empty array / empty string — never null, never throw</error>
</interface>

<interface name="init-phase-output-keys">
  <input>existing init-phase.ts JSON output shape</input>
  <output>output root includes `exemplarsByTask: Record&lt;taskId, string[]&gt;` and `nonGoalsByTask: Record&lt;taskId, string&gt;`. Every task id present in the tasks map has an entry in both records (empty defaults when fields absent).</output>
</interface>

<behavior name="validate-plan-accepts-new-fields">
  <precondition>task in plan contains optional lines `**Exemplars**: src/a.ts, src/b.ts` and/or `**Non-goals**: do not touch auth`</precondition>
  <postcondition>validate-plan.ts reports no error for the new fields. Absence of either field is also not an error. No other task-level field parsing is regressed.</postcondition>
</behavior>

<behavior name="builder-prompt-section-order">
  <precondition>orchestrator dispatches a builder via Task call in build.md (phase loop) or talk.md INLINE PATH (Step 8i-b)</precondition>
  <postcondition>builder prompt sections appear in this exact order: `## Conventions`, `## Code Structure` (if non-empty), `## Exemplars` (only if exemplarsByTask[id] non-empty), `## Spec Contracts` (if non-empty), `## Non-goals` (only if nonGoalsByTask[id] non-empty), followed by cache section(s). Empty optional sections are omitted entirely.</postcondition>
  <invariant>both build.md and talk.md use the identical section order. No divergence.</invariant>
</behavior>

<behavior name="orchestrator-taskupdate-flow">
  <precondition>builder Task call returns for a wave task</precondition>
  <postcondition>after each Agent return, orchestrator calls TaskUpdate on the returned task's id. On builder success (task produced a matching commit), status is "completed". On builder failure, orchestrator follows the existing retry flow without calling TaskUpdate to "completed". TaskList check at wave-end still verifies all tasks completed.</postcondition>
  <invariant>builder prompts do NOT contain the "CRITICAL: call TaskUpdate with status 'completed'" line in build.md or talk.md.</invariant>
</behavior>

<behavior name="plan-format-new-fields-documented">
  <precondition>commands/talk.md Plan Format section documents task fields</precondition>
  <postcondition>Plan Format section adds `**Exemplars**: comma-separated file paths (optional)` and `**Non-goals**: one-line description (optional)` as documented optional task fields. Example task in Plan Format includes both fields as commented optional lines.</postcondition>
</behavior>

<behavior name="spec-density-guidance">
  <precondition>commands/talk.md Step 6 (Design solution) describes spec drafting</precondition>
  <postcondition>Step 6 adds explicit guidance: each task with substantive implementation logic must have ≥1 `<interface>` OR `<behavior>` OR `<error-contract>` spec. Tasks with zero specs are flagged as under-specified.</postcondition>
</behavior>

<behavior name="wider-waves-default">
  <precondition>commands/talk.md Parallelization Rules section biases toward wide waves</precondition>
  <postcondition>Parallelization Rules explicitly state default wave target is 4-5 tasks; narrower waves only when a documented constraint applies (shared files, producer-consumer dep, <4 total tasks in phase). Existing no-shared-file and no-producer-consumer rules remain.</postcondition>
</behavior>

<behavior name="phase-consolidation-default">
  <precondition>commands/talk.md Sizing Rules and Phase consolidation guidance exist</precondition>
  <postcondition>guidance strengthened to prefer fewer phases: phases with no handoff dependency and no shared-file conflict MUST be merged; planner must justify any split into multiple phases. Overhead rationale (~2-3 min per phase) reiterated.</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Remove TaskUpdate mandate from builders
- **ID**: builders-taskupdate
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: no-taskupdate-mandate
- **Non-goals**: do not change any other workflow steps; do not rewrite the Workflow section narrative; keep step numbering sequential after removal
- In `agents/devorch-builder.md`: remove step 9 (lines describing `CRITICAL — Mark task completed` with TaskUpdate). Renumber subsequent step (final output step becomes step 9). Remove the red-flag table row referencing "Vou pular o TaskUpdate".
- In `agents/devorch-builder-deep.md`: identical edits (same step 9, same red-flag row).
- Verify via grep that neither file contains any remaining occurrence of `TaskUpdate` after edits.
- Commit with `refactor(agents): remove TaskUpdate mandate from builders`.

#### 2. init-phase.ts — sanitize spec regex + parse new fields
- **ID**: init-phase-updates
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: sanitize-spec-regex, parseTaskFields-exemplars-nongoals, init-phase-output-keys
- **Exemplars**: scripts/init-phase.ts
- **Non-goals**: do not refactor the parseTasks function shape; do not change EXT_KEYWORDS or FAST_PATH_WHITELIST; do not alter existing conventionSectionsByTask or specsByTask logic
- Modify `shouldIncludeTesting(taskContent, taskRefs)` in `scripts/init-phase.ts` (near line 262): before applying the existing `/\btest\b|\bspec\b/i` regex, apply `taskContent.replace(/^\s*\*\*Spec refs\*\*:.*$/gmi, "")` to sanitize the metadata label line. Do not change the test file reference check branch.
- In `parseTasks` (the function that builds each TaskInfo): add extraction of `**Exemplars**: ...` (comma-separated, trim, empty array if absent) and `**Non-goals**: ...` (single-line text, trim, empty string if absent). Store on TaskInfo as `exemplars: string[]` and `nonGoals: string`.
- Update the TaskInfo TypeScript type to include the two new fields.
- In the main loop that builds per-task output maps (around line 560-617), construct `exemplarsByTask: Record<string, string[]>` and `nonGoalsByTask: Record<string, string>`. Every task id in the `tasks` map gets an entry in both (empty array / empty string when absent).
- Add both maps to the JSON output object returned by the script.
- Update any interface describing the script output (if exported) to include the new keys.
- Commit with `feat(init-phase): parse Exemplars/Non-goals + sanitize spec regex`.

#### 3. validate-plan.ts — accept new optional fields
- **ID**: validate-plan-fields
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: validate-plan-accepts-new-fields
- **Exemplars**: scripts/validate-plan.ts
- **Non-goals**: do not change any existing field validation (ID, Assigned To, Model, Effort, Repo, Spec refs); do not alter phase or top-level tag validation
- In `scripts/validate-plan.ts`, locate the task-level field validation block. Add `**Exemplars**` and `**Non-goals**` as recognized optional fields. Neither is required. Neither produces an error when present with any non-empty value. Absence is also not an error.
- If validate-plan uses an allow-list or recognized-fields list for warnings about unknown fields, extend the list to include these two.
- Run validation against an existing plan (e.g., one of the files under `.devorch/plans/` in main) to confirm backward compat — no new errors introduced.
- Commit with `feat(validate-plan): accept Exemplars and Non-goals optional task fields`.

#### 4. commands/build.md — orchestrator TaskUpdate + inject new sections
- **ID**: commands-build-updates
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: builder-prompt-section-order, orchestrator-taskupdate-flow
- **Exemplars**: commands/talk.md
- **Non-goals**: do not modify any step outside the builder-dispatch block (step 2c) and the related TaskList verification (step 2c end); do not change retry flow, do not change Build Report extraction, do not change satellite handling; do not touch final verification (step 3) unless necessary for TaskUpdate flow
- In `commands/build.md` step 2c (Deploy builders): remove the bullet line `- \`CRITICAL: call TaskUpdate with status "completed" as your very last action\`` from the builder prompt enumeration.
- In the same step, extend the builder prompt enumeration to include injection instructions for new sections: `## Exemplars` (from `exemplarsByTask[taskId]`, only when array non-empty, format as `- path/to/file.ext` one per line) positioned AFTER `## Code Structure` and BEFORE `## Spec Contracts`; `## Non-goals` (from `nonGoalsByTask[taskId]`, only when string non-empty, format as a single bullet or short paragraph) positioned AFTER `## Spec Contracts` and BEFORE cache sections. Explicitly spell out the section order.
- After the "After all builders in a wave return, verify via `TaskList`..." sentence, add an instruction: for each task in the wave whose Agent call returned with a matching commit (success), the orchestrator calls `TaskUpdate` with `status: "completed"`. On builder failure, orchestrator follows the existing retry flow (no TaskUpdate to completed).
- Keep all other logic intact (Build Report extraction, retry counter, multi-repo handling).
- Commit with `feat(build): orchestrator owns TaskUpdate + inject Exemplars/Non-goals`.

#### 5. commands/talk.md — INLINE dispatch + Plan Format + planner guidance
- **ID**: commands-talk-updates
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: builder-prompt-section-order, orchestrator-taskupdate-flow, plan-format-new-fields-documented, spec-density-guidance, wider-waves-default, phase-consolidation-default
- **Exemplars**: commands/build.md
- **Non-goals**: do not alter the AskUserQuestion-driven clarification flow (Step 3); do not change worktree/inline routing logic; do not change Devil's Advocate section; do not change merge-worktree invocation in step 10i
- In Step 8i (b) Deploy builders: remove the line `- \`CRITICAL: call TaskUpdate with status "completed" as your very last action\``. Extend the builder prompt enumeration with the same `## Exemplars` + `## Non-goals` injection and position rules as build.md (same section order). After the `TaskList` verification sentence, add the same orchestrator-side `TaskUpdate` instruction.
- Plan Format section: document `**Exemplars**: comma-separated file paths (optional)` and `**Non-goals**: one-line description (optional)` as optional task fields. Update the example task inside the fenced Plan Format block to show these lines as commented optional examples. Update the Plan Format Rules bullet list to include both fields in the "Task fields" line.
- Step 6 (Design solution): add a paragraph at the end of the "Spec drafting" subsection stating: each task with substantive implementation logic must have ≥1 `<interface>` OR `<behavior>` OR `<error-contract>` spec. Tasks with zero specs should be flagged as under-specified during planning and either split or merged.
- Parallelization Rules section: change the default target — state that default wave target is 4-5 tasks; narrower waves (1-3 tasks) require a documented constraint (shared files, producer-consumer dep, or phase has fewer than 4 tasks total). Keep the existing no-shared-file and no-producer-consumer guardrails.
- Sizing Rules and Phase consolidation guidance (Step 6): strengthen — phases with no handoff dependency and no shared-file conflict MUST be merged into one phase; explicitly state that the planner must justify any split. Retain the ~2-3 min per-phase overhead rationale.
- Commit with `feat(talk): orchestrator TaskUpdate + exemplars/non-goals + wider waves + phase consolidation`.
</tasks>

<execution>
**Wave 1** (parallel): builders-taskupdate, init-phase-updates, validate-plan-fields
**Wave 2** (after wave 1): commands-build-updates, commands-talk-updates
</execution>

<criteria>
- [ ] `grep -r "TaskUpdate" agents/` returns no matches
- [ ] `grep -n "Spec refs" scripts/init-phase.ts` shows sanitization regex `\\*\\*Spec refs\\*\\*:.*$` is applied in shouldIncludeTesting before the `\btest\b|\bspec\b` regex
- [ ] `init-phase.ts` JSON output includes `exemplarsByTask` and `nonGoalsByTask` keys for a plan with no such fields (both maps present, values empty)
- [ ] `init-phase.ts` JSON output correctly parses `**Exemplars**: a.ts, b.ts` into `["a.ts", "b.ts"]` and `**Non-goals**: do not X` into `"do not X"`
- [ ] `validate-plan.ts` runs against this plan file with no errors (self-test)
- [ ] `commands/build.md` contains no `CRITICAL: call TaskUpdate` line and contains the new section-order instructions for Exemplars/Non-goals
- [ ] `commands/talk.md` contains no `CRITICAL: call TaskUpdate` line in INLINE PATH Step 8i, contains Plan Format docs for both new fields, contains 4-5 tasks/wave default in Parallelization Rules, contains strengthened phase consolidation guidance
- [ ] Both command files pin the identical section order: Conventions → Code Structure → Exemplars → Spec Contracts → Non-goals → Cache
- [ ] `bun run check` (typecheck via tsc or bun) passes
</criteria>
</phase1>
