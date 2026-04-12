# Plan: Build quality improvements — contract-first builders, per-task verification, spec scoring

<description>
Improve devorch build quality through 4 complementary changes: (1) builder agents map and verify contracts before/after implementation, (2) per-task contract verification catches spec violations immediately, (3) validate-plan.ts warns on vague specs, (4) refined task scoping rules prefer focused tasks in wider waves.
</description>

<objective>
Builders consistently respect spec contracts, violations are caught per-task (not just at final review), vague specs are flagged at plan validation time, and task scoping guidance produces more focused tasks.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: medium
</classification>

<decisions>
- Focus: holistic pipeline improvement (plan + context + verification + feedback loops)
- Contract violations are dispersed across interface, error handling, and behavior types
- Per-task contract verification approved (over per-wave or final-only)
- Quality > velocity tradeoff: balanced — improve quality without doubling build time
- Typed debt deferred — fix root cause first (spec clarity + verification)
- Spec concreteness: warnings, not blockers
- Task scoping: 1 task = 1 responsibility as principle, not hard file count limit
- Verification only runs when task has explicit **Spec refs** in the plan
- git diff per-task: use git log to find builder's specific commit, then git show — not HEAD~1
- VIOLATION flow: git revert --no-commit → retry with violation context → counts toward existing 3-retry budget
- Shared verifier prompt template for build.md and talk.md to prevent behavioral divergence
</decisions>

<problem-statement>
Builders sometimes don't respect spec contracts — interface types, error handling, behavior invariants. Violations are only caught at final adversarial review, making fixes expensive. Specs can be vague without warning. Tasks can bundle multiple responsibilities, reducing focus and quality.
</problem-statement>

<solution-approach>
Four complementary improvements targeting different pipeline stages:

1. **Builder contract-first flow** (agent prompt change): Force builders to explicitly map specs to files/functions before coding, then self-verify after. This is chain-of-thought for contract compliance — the model attends to specs rather than jumping to implementation.

2. **Per-task contract verification** (orchestration change): After each builder commits, a lightweight sonnet verifier checks the diff against task specs. Catches violations immediately (~30-45s overhead) instead of at final review (where fixes are expensive). Uses git log to find builder-specific commit hash, then git show for isolated diff.

3. **Spec concreteness warnings** (validation change): Regex heuristics flag vague spec language at plan validation time. Zero runtime overhead during build. Warning fatigue mitigated by requiring ≥2 vague indicators AND 0 observable indicators per spec element before flagging.

4. **Task scoping refinement** (planning guidance): "1 task = 1 responsibility" principle reconciled with existing "cohesive multi-file OK" rule. Guidance (not computable rule) for the planner to prefer focused tasks in wider waves.

**Shared verifier prompt template** (used identically by build.md and talk.md):

```
You are a contract verifier. Given a git diff and spec contracts, check whether the implementation satisfies each spec element.

For each spec element (interface, error-contract, behavior, invariant, endpoint):
1. Find the relevant changes in the diff
2. Check if the implementation matches the spec requirements
3. Report PASS or VIOLATION with specifics

Output format (EXACTLY this structure):
VERDICT: PASS | VIOLATION
- <spec-name>: PASS | VIOLATION — <one-line details if violation>
```

Alternatives considered:
- Typed debt (SWE-AF style): deferred — addresses symptom, not cause
- Full Architect/Editor split: too disruptive for devorch's existing builder model
- TDD-driven verification: requires per-project test framework, too much overhead
</solution-approach>

<relevant-files>
- `agents/devorch-builder.md` — builder agent prompt, add contract-first flow
- `agents/devorch-builder-deep.md` — deep builder agent prompt, same changes
- `scripts/validate-plan.ts` — plan validation, add concreteness warnings
- `commands/build.md` — build orchestration, add per-task verification
- `commands/talk.md` — planning + inline build, add per-task verification + scoping refinement

<new-files>
</new-files>
</relevant-files>

<phase1 name="Pipeline Quality Improvements">
<goal>Add contract-first builder flow, per-task verification, spec concreteness warnings, and task scoping refinement across all relevant devorch files</goal>

<spec>
<behavior name="contract-map-before-implementation">
  <precondition>Builder receives task with ## Spec Contracts section containing 1+ named spec elements</precondition>
  <postcondition>Builder produces a CONTRACT MAP listing each spec name, the file(s) and function(s) where it will be satisfied, and the approach — before writing any code. The map is text output in the builder's response, not a file.</postcondition>
</behavior>

<behavior name="self-verify-after-implementation">
  <precondition>Builder has implemented all task actions and produced a CONTRACT MAP earlier in the session</precondition>
  <postcondition>Builder reads each modified file and explicitly checks whether each spec in the CONTRACT MAP is satisfied. If a violation is found, builder fixes it before committing. Self-verification is documented as text output listing each spec with PASS/VIOLATION status.</postcondition>
</behavior>

<interface name="contract-verifier-agent">
  <input>Git diff text (from `git show <commit-hash>`), spec contracts XML text (from specsByTask[taskId]), task goal text (one sentence from task content)</input>
  <output>Structured text: first line "VERDICT: PASS" or "VERDICT: VIOLATION", followed by per-spec-element lines "- <spec-name>: PASS | VIOLATION — <one-line details if violation>"</output>
  <error case="no-explicit-specs">Skip verification entirely, log "No explicit spec refs — skipping contract verification"</error>
  <error case="no-commit-found">Skip verification, log "No commit found for task <taskId> — skipping contract verification"</error>
</interface>

<behavior name="violation-retry-flow">
  <precondition>Contract verifier returned "VERDICT: VIOLATION" for a builder's commit identified by <commit-hash></precondition>
  <postcondition>Orchestrator runs `git revert --no-commit <commit-hash>` then `git reset HEAD` to unstage, re-launches the builder with original task context plus "## Contract Violation" section containing the verifier's per-spec findings. Retry counts toward existing 3-retry budget per task ID. On budget exhaustion, phase stops with same structured failure format as existing retry logic.</postcondition>
</behavior>

<interface name="spec-concreteness-check">
  <input>Parsed plan spec elements: interface input/output text, behavior precondition/postcondition text, error-contract case trigger/handling text, endpoint request/response text</input>
  <output>Array of warning strings appended to existing warnings[] in validate-plan.ts JSON output. Format: "Spec '<name>' has vague <element>: '<matched-text>' — consider specifying concrete types/behaviors"</output>
  <error case="no-specs-in-plan">Return empty array — no warnings to emit</error>
</interface>

<invariant>The verifier prompt template used in build.md and talk.md must be identical text — no behavioral divergence between worktree path and inline path</invariant>

<invariant>Contract verification only runs when the task has an explicit **Spec refs** field in the plan — tasks inheriting full phase specs are not verified</invariant>

<invariant>Existing sizing rule "Tasks can span multiple related files when the changes are cohesive" is preserved — new "1 task = 1 responsibility" is additive guidance clarifying that "cohesive" means single responsibility</invariant>
</spec>

<tasks>
#### 1. Contract-First Builder Flow
- **ID**: builder-contract-first
- **Assigned To**: builder-1
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: contract-map-before-implementation, self-verify-after-implementation
- Add CONTRACT MAP step to `agents/devorch-builder.md`: after receiving task context, before implementation, builder must list each spec from ## Spec Contracts by name, identify target file(s) and function(s), and describe the approach to satisfy each. This is a new numbered step in the workflow
- Add SELF-VERIFY step to `agents/devorch-builder.md`: after implementation and before committing, builder must read each modified file and verify each spec from the CONTRACT MAP is satisfied, reporting PASS/VIOLATION per spec. If VIOLATION found, fix before commit. This is a new numbered step
- Apply identical changes to `agents/devorch-builder-deep.md`
- Keep changes minimal — add 2 numbered steps to the existing workflow, do not restructure the entire agent prompt
- Preserve existing PostToolUse hooks, disallowed-tools, Build Report format, and all other existing content
- If builder receives task without ## Spec Contracts section, skip both CONTRACT MAP and SELF-VERIFY steps

#### 2. Spec Concreteness Warnings
- **ID**: spec-concreteness
- **Assigned To**: builder-2
- **Model**: opus
- **Effort**: medium
- **Spec refs**: spec-concreteness-check
- In `scripts/validate-plan.ts`, add a `checkSpecConcreteness()` function that runs after structural validation completes
- Implement vagueness indicator detection via regex on: interface input/output text, behavior precondition/postcondition text, error-contract case trigger/handling text, endpoint request/response text
- Vague indicators (regex patterns, case-insensitive): `/\bobject\b/`, `/\bdata\b/`, `/\bany\b/`, `/\bappropriate\b/`, `/\bcorrect(ly)?\b/`, `/\bproper(ly)?\b/`, `/\bas needed\b/`, `/\brelevant\b/`, `/\bhandle correctly\b/`, `/\bshould process\b/`, `/\bshould manage\b/`, `/\bshould handle\b/`
- Observable indicators (positive signals that spec IS concrete): `/\bstring\b/`, `/\bnumber\b/`, `/\bboolean\b/`, `/\bnull\b/`, `/\bundefined\b/`, `/[{}\[\]]/`, `/\breturns?\b/`, `/\bcontains?\b/`, `/\bequals?\b/`, `/\bexists?\b/`, `/\bthrows?\b/`, `/\bstatus\b/`, `/\b\d{3}\b/` (HTTP status codes)
- Threshold: warn when a spec element has ≥2 vague indicators AND 0 observable indicators
- Append findings to existing `warnings[]` array as strings matching format in spec
- Follow existing script patterns: no external deps, regex-based, push to warnings array, let existing JSON output serialization handle display

#### 3. Per-Task Contract Verification in Build
- **ID**: build-contract-verify
- **Assigned To**: builder-3
- **Model**: opus
- **Effort**: medium
- **Spec refs**: contract-verifier-agent, violation-retry-flow
- In `commands/build.md` phase loop (step 2c), add per-task contract verification AFTER builder completion verification and Build Report extraction, BEFORE moving to next wave
- For each completed task in the wave: check if the task body (from `tasks[taskId]` in init-phase output) contains an explicit `**Spec refs**:` field with non-empty value. If absent or empty, log "No explicit spec refs for <taskId> — skipping contract verification" and skip
- Find builder's commit hash: run `git -C <projectRoot> log --oneline --format="%H %s" -20` and search for commit message containing the task ID. Extract the hash. If no match found, skip verification with log message
- Extract diff: `git -C <projectRoot> show <commit-hash>` (full diff including stat)
- Launch verification agent: `subagent_type="Explore"`, `model="sonnet"`. The prompt MUST use the exact verifier template from the `<solution-approach>` section above, followed by the actual git diff and spec contracts text
- Parse verifier output: search for line starting with "VERDICT:" — extract PASS or VIOLATION
- On PASS: log "Contract verification PASS for <taskId>" and continue
- On VIOLATION: run `git -C <projectRoot> revert --no-commit <commit-hash>` then `git -C <projectRoot> reset HEAD`. Re-launch builder with original task context plus appended section: `## Contract Violation\nThe following spec violations were found in your previous implementation:\n<verifier output>\nFix all violations listed above.` Count as retry (increment existing per-task retry counter). On 3 retries exhausted, stop phase with existing structured failure format
- Document this as a new sub-step within the builder deployment step, clearly numbered

#### 4. Per-Task Verification in Talk Inline Path + Task Scoping
- **ID**: talk-verify-and-scoping
- **Assigned To**: builder-4
- **Model**: opus
- **Effort**: high
- **Spec refs**: contract-verifier-agent, violation-retry-flow
- **Part A — Per-task verification**: In `commands/talk.md` inline path step 8i-b (Deploy builders), add IDENTICAL per-task contract verification logic as described in Task 3 (build-contract-verify) above. Place after builder completion verification and Build Report extraction. Use the EXACT same verifier prompt template, same VIOLATION flow, same git log + git show approach, same retry budget interaction. The text should be as close to identical as possible between build.md and talk.md to prevent behavioral divergence
- **Part B — Task scoping refinement**: In `commands/talk.md` Sizing Rules section, add the following guidance after the existing max-5-tasks rule:
  - Principle: "1 task = 1 responsibility" — a task should address one cohesive concern. This clarifies the existing "Tasks can span multiple related files when the changes are cohesive" by defining cohesive = single responsibility
  - Guidance: recommend splitting when a task's Spec refs point to specs operating on clearly different components/modules (semantic judgment by the planner, not a computable rule)
  - Guidance: when a task is classified opus/high and the complexity comes from volume rather than reasoning depth, consider splitting into 2 tasks at sonnet/medium IF the resulting tasks are parallelizable (no producer/consumer dependency)
  - Guidance: prefer wider waves with focused tasks over narrower waves with complex tasks — 4 focused tasks in 1 parallel wave beats 2 complex tasks in 1 wave
- In Phase consolidation guidance section, add: "When splitting a task creates additional tasks that fit in the same wave without file conflicts, consolidation into the same phase adds zero overhead — only phase boundaries (not wave boundaries) incur pipeline overhead"
</tasks>

<execution>
**Wave 1** (parallel): builder-contract-first, spec-concreteness, build-contract-verify, talk-verify-and-scoping
</execution>

<criteria>
- [ ] devorch-builder.md and devorch-builder-deep.md include CONTRACT MAP and SELF-VERIFY numbered steps in their workflow
- [ ] CONTRACT MAP and SELF-VERIFY are conditional on ## Spec Contracts being present
- [ ] validate-plan.ts checkSpecConcreteness() warns on spec elements with ≥2 vague indicators and 0 observable indicators
- [ ] validate-plan.ts concreteness warnings use the specified format string
- [ ] build.md has per-task contract verification after builder completion, before next wave
- [ ] build.md verification finds commit via git log, extracts diff via git show
- [ ] build.md VIOLATION flow: git revert --no-commit + reset, retry with violation context, 3-retry budget
- [ ] talk.md inline path has identical per-task verification logic as build.md (same template, same flow)
- [ ] talk.md sizing rules include "1 task = 1 responsibility" guidance
- [ ] talk.md sizing rules reconcile with existing "cohesive multi-file" rule (additive, not replacement)
- [ ] talk.md phase consolidation includes wave-vs-phase overhead clarification
- [ ] Verifier prompt template is word-for-word identical in build.md and talk.md
</criteria>
</phase1>
