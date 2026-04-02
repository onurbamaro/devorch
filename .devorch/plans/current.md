# Plan: Spec-Driven Talk Phase

<description>
Add structured specification contracts to the devorch plan format, replacing the unused `<test-contract>` with a rich `<spec>` section. Integrate spec extraction, filtering, and validation across the full pipeline: talk generates specs → validate-plan checks quality → init-phase extracts and filters by task → builders receive and verify against specs.
</description>

<objective>
When this plan is complete: (1) the plan format includes a `<spec>` section per phase with typed sub-tags (interface, error-contract, behavior, invariant, endpoint), (2) tasks reference specs via `**Spec refs**`, (3) talk.md auto-proposes specs during clarification, (4) validate-plan.ts validates spec presence and quality, (5) init-phase.ts extracts specs and filters by task refs into `specsByTask`, (6) builders receive specs as first-class context and verify implementation against them.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: low
</classification>

<decisions>
Scope → Full pipeline (talk → init-phase → builder → validate-plan)
Spec types → All 4: interface contracts, error contracts, behavioral contracts (DbC), API contracts (OpenAPI-style)
test-contract fate → Evolve into `<spec>` section (replace, not keep alongside)
Formalism level → Structured by type with specific XML sub-tags per spec type
Spec location → Phase-level `<spec>` section, tasks reference by name via `**Spec refs**`
Spec generation → Auto-propose during clarification based on exploration, user confirms/adjusts
Validation level → Presence + quality (warn empty, block malformed: interface needs input+output, error-contract needs ≥1 case)
Repos → Only devorch (no satellites)
</decisions>

<problem-statement>
The devorch talk phase produces plans with structural specifications (criteria checklists, goals) but lacks behavioral specifications. Builders receive narrative context but no formal contracts, leading to assumption-driven implementation. The `<test-contract>` section exists in the format but has zero usage across all archived plans. Research confirms that LLMs with formal specs produce significantly better code (SpecGen: 100/120 verified vs 72 without).
</problem-statement>

<solution-approach>
Replace `<test-contract>` with a structured `<spec>` section containing typed sub-tags:
- `<interface name="...">` — function/module signatures with `<input>`, `<output>`, `<error case="...">`
- `<error-contract name="...">` — error classification with `<case trigger="..." handling="..." />`
- `<behavior name="...">` — DbC-style with `<precondition>`, `<postcondition>`
- `<invariant>` — standalone constraints that must always hold
- `<endpoint path="..." method="...">` — REST/GraphQL contracts with `<request>`, `<response status="...">`

Tasks reference specs via `**Spec refs**: spec-name-1, spec-name-2`. init-phase.ts resolves refs and filters specs per task into `specsByTask` (same pattern as `conventionsByTask`).

Alternative considered: Inline specs in task descriptions (SPEC: prefix). Rejected — harder to extract, validate, and filter; causes duplication when tasks share contracts.

Alternative considered: Plan-level global specs. Rejected — specs are often phase-specific; global specs too broad for multi-phase plans.

The talk.md clarification step (Step 3) gains a spec proposal sub-step: after exploration, orchestrator auto-proposes draft specs based on findings, user confirms or adjusts. This avoids burdening users with writing specs from scratch.
</solution-approach>

<relevant-files>
- `commands/talk.md` — plan format definition, clarification step, spec generation logic
- `commands/build.md` — builder prompt composition, must include specsByTask
- `scripts/validate-plan.ts` — plan validation, replace test-contract with spec validation
- `scripts/init-phase.ts` — phase context extraction, must extract and filter specs
- `scripts/lib/plan-parser.ts` — shared parsing utilities, needs spec extraction functions
- `agents/devorch-builder.md` — builder instructions, must add spec verification step

<new-files>
(none — all changes to existing files)
</new-files>
</relevant-files>

<phase1 name="Spec Format and Validation">
<goal>Define the `<spec>` format in talk.md, add spec parsing utilities to plan-parser.ts, and update validate-plan.ts to validate spec presence and quality.</goal>

<tasks>
#### 1. Add spec format to talk.md plan template and clarification
- **ID**: talk-spec-format
- **Assigned To**: builder-1
- In the **Plan Format** section (~line 467), replace `<test-contract>` with `<spec>` in the phase template. The `<spec>` section goes between `<goal>` and `<tasks>` (so tasks can reference spec names). Include all 5 sub-tag types in the template with brief inline comments:
  ```xml
  <spec>
  <interface name="unique-name">
    <input>parameter descriptions with types</input>
    <output>return value description with types</output>
    <error case="error-name">expected behavior</error>
  </interface>
  <error-contract name="unique-name">
    <case trigger="condition" handling="expected behavior" />
  </error-contract>
  <behavior name="unique-name">
    <precondition>what must be true before</precondition>
    <postcondition>what must be true after</postcondition>
  </behavior>
  <invariant>condition that must always hold</invariant>
  <endpoint path="/path" method="METHOD">
    <request>schema or description</request>
    <response status="NNN">schema or description</response>
  </endpoint>
  </spec>
  ```
- Add `**Spec refs**` as an optional task field (after `**Repo**`): `**Spec refs**: <comma-separated spec names from phase <spec> section>`
- In **Plan Format Rules** section (~line 557), update:
  - Replace `<test-contract> (optional)` with `<spec>` in the "Inside phase" list
  - Add: "Inside spec: `<interface name>`, `<error-contract name>`, `<behavior name>`, `<invariant>`, `<endpoint path method>`. All names must be unique within a phase."
  - Add `**Spec refs**` to the "Task fields" list as optional
- In **Step 3 (Clarify)** (~line 112), add a new bullet to "What to ask about":
  - **Contracts & specs** — What are the input/output contracts? What error cases must be handled? What invariants must hold? What API shapes are needed?
- After Step 3 (after user answers), add a **Step 3b: Propose specs** sub-step:
  - "Based on exploration findings and user answers, draft spec contracts for each planned phase. Use `AskUserQuestion` to present the proposed specs and let the user confirm, adjust, or reject. Group specs by phase. Include concrete examples derived from the exploration (real function names, real error cases discovered). If the user confirms, include specs verbatim in the plan. If the user adjusts, incorporate changes."
- In **Step 6 (Design solution)**, add a note: "Include `<spec>` section design as part of solution design. Each phase should have specs that define the contracts builders must implement. Prefer fewer, more precise specs over many vague ones."
- Remove ALL references to `<test-contract>` throughout the file (it is fully replaced by `<spec>`)

#### 2. Add spec parsing to plan-parser.ts and update validate-plan.ts
- **ID**: spec-parsing-validation
- **Assigned To**: builder-2
- **In `scripts/lib/plan-parser.ts`**, add these exported functions:
  - `extractPhaseSpec(phaseContent: string): string | null` — extracts raw content between `<spec>` and `</spec>` tags from a phase block. Return null if no spec section.
  - `parseSpecNames(specContent: string): string[]` — extracts all `name="..."` values from interface, error-contract, behavior tags, plus generates implicit names for invariant (e.g., "invariant-1") and endpoint (e.g., "GET-/path") tags. Returns array of unique spec names.
  - `filterSpecsByRefs(specContent: string, refs: string[]): string` — given raw spec content and an array of spec ref names, returns only the spec sub-tags whose names match. For invariants and endpoints without explicit names, use the implicit naming from parseSpecNames.
  - Add TypeScript types: `SpecType = "interface" | "error-contract" | "behavior" | "invariant" | "endpoint"`
  - Follow existing patterns: regex-based parsing (no XML parser), arrow functions for short utilities, double quotes, semicolons
- **In `scripts/validate-plan.ts`**, replace test-contract validation with spec validation:
  - Remove the existing `<test-contract>` check (currently ~line 141-145 area, warns if empty)
  - Add spec validation after criteria validation for each phase:
    - **Presence**: If `<spec>` is missing from a phase, add a warning (not blocking): "Phase N has no <spec> section"
    - **Structural**: If `<spec>` exists, validate sub-tags are well-formed:
      - `<interface>` must have `name` attribute, must contain `<input>` and `<output>` (block if missing)
      - `<error-contract>` must have `name` attribute, must contain at least 1 `<case>` (block if missing)
      - `<behavior>` must have `name` attribute, must contain at least `<precondition>` or `<postcondition>` (block if missing)
      - `<invariant>` must have non-empty text content (block if empty)
      - `<endpoint>` must have `path` and `method` attributes, must contain at least 1 `<response>` (block if missing)
    - **Uniqueness**: All spec names within a phase must be unique (block on duplicate)
    - **Ref integrity**: If tasks have `**Spec refs**`, each referenced name must exist in the phase's `<spec>` section (block on broken ref)
    - **Quality warnings** (non-blocking):
      - `<interface>` with `<input>` or `<output>` that is just "..." or placeholder text
      - `<error-contract>` with only 1 case (suggest covering more cases)
  - Import `extractPhaseSpec` and `parseSpecNames` from `./lib/plan-parser` if useful, but the validator can also implement its own parsing inline (match existing patterns in the file)
</tasks>

<execution>
**Wave 1** (parallel): talk-spec-format, spec-parsing-validation
</execution>

<criteria>
- [ ] talk.md plan format template contains `<spec>` section with all 5 sub-tag types (interface, error-contract, behavior, invariant, endpoint)
- [ ] talk.md has no remaining references to `<test-contract>`
- [ ] talk.md Step 3 includes contracts/specs in clarification topics
- [ ] talk.md has Step 3b for auto-proposing specs
- [ ] plan-parser.ts exports extractPhaseSpec, parseSpecNames, filterSpecsByRefs
- [ ] validate-plan.ts blocks on malformed specs (interface without input/output, error-contract without case, etc.)
- [ ] validate-plan.ts warns on missing `<spec>` section (non-blocking)
- [ ] validate-plan.ts validates spec ref integrity (task refs match phase spec names)
</criteria>

<handoff>
Phase 1 establishes the spec format (in talk.md), parsing utilities (in plan-parser.ts), and validation (in validate-plan.ts). Phase 2 needs:
- The exact `<spec>` tag structure and sub-tag format defined in talk.md
- The exported functions from plan-parser.ts: `extractPhaseSpec`, `parseSpecNames`, `filterSpecsByRefs`
- Understanding that validate-plan.ts now validates specs, so plans entering phase 2's pipeline will have validated specs
</handoff>
</phase1>

<phase2 name="Pipeline Integration">
<goal>Wire specs through the full pipeline: init-phase.ts extracts and filters specs per task, build.md passes specs to builders, devorch-builder.md adds spec verification to builder workflow.</goal>

<tasks>
#### 1. Extract and filter specs in init-phase.ts
- **ID**: init-phase-specs
- **Assigned To**: builder-3
- **Spec refs**: (none — this task implements the spec filtering mechanism itself)
- Import `extractPhaseSpec` and `filterSpecsByRefs` from `./lib/plan-parser`
- In the phase content assembly section (~line 440-505), after extracting conventions and cache:
  - Extract `<spec>` section from the current phase using `extractPhaseSpec`
  - For each task, read `**Spec refs**` field (regex: `/\*\*Spec refs\*\*:\s*(.+)/`)
  - Split refs by comma, trim whitespace
  - Use `filterSpecsByRefs(specContent, refs)` to get task-specific specs
  - Add `specsByTask: Record<string, string>` to the JSON output structure (parallel to `conventionsByTask` and `cacheByTask`)
  - If a task has no Spec refs, include the FULL spec section for that task (so all builders have context of the phase's contracts)
- In the `content` field assembly, include the full `<spec>` section as a clearly labeled section:
  ```
  ## Spec Contracts
  <full spec section content>
  ```
- Update the JSON output type/interface comments to document `specsByTask`

#### 2. Update build.md builder prompt composition
- **ID**: build-spec-prompt
- **Assigned To**: builder-4
- In the builder deployment section (Step 2b, ~line 82-89), add `specsByTask[taskId]` to the list of context each builder receives. Add it after conventions and before cache:
  - `Spec contracts from specsByTask[taskId]` — labeled as "## Spec Contracts" in the builder prompt
- Add instruction to builder prompt: "Verify your implementation satisfies all spec contracts before committing. Check: function signatures match `<interface>` specs, error handling matches `<error-contract>` cases, pre/postconditions from `<behavior>` specs are honored."
- In the init-phase JSON output description (~line 70), add `specsByTask` to the documented fields
- In the adversarial review section (Step 3b, ~line 176-195), update the completeness-reviewer mandate to include: "Implementation matches `<spec>` contracts — function signatures, error handling, behavioral pre/postconditions, API response shapes"

#### 3. Add spec verification to devorch-builder.md
- **ID**: builder-spec-verify
- **Assigned To**: builder-5
- In the builder workflow section (~line 20-26), add a verification step before committing:
  - "**Spec verification**: Before committing, verify your implementation against the Spec Contracts section in your context:
    - `<interface>` specs: function signatures match (parameter names/types, return types)
    - `<error-contract>` specs: all specified error cases are handled with correct behavior
    - `<behavior>` specs: preconditions are checked, postconditions are guaranteed
    - `<invariant>` specs: implementation preserves stated invariants
    - `<endpoint>` specs: request/response shapes match, all status codes handled
    If a spec cannot be satisfied, document why in your commit message."
- In the effort guidance section (~line 87), update "You have a clear spec" to: "You have clear spec contracts — implement against them precisely. Check the Spec Contracts section for interface signatures, error handling rules, behavioral pre/postconditions, and invariants."
- Do NOT change the zero-tolerance policy or other existing sections — only add spec verification
</tasks>

<execution>
**Wave 1** (parallel): init-phase-specs, build-spec-prompt, builder-spec-verify
</execution>

<criteria>
- [ ] init-phase.ts outputs `specsByTask` in JSON with filtered specs per task
- [ ] init-phase.ts includes full spec section in content field under "## Spec Contracts"
- [ ] Tasks without Spec refs receive the full phase spec section
- [ ] build.md passes specsByTask to builders alongside conventions and cache
- [ ] build.md completeness-reviewer checks implementation against specs
- [ ] devorch-builder.md includes spec verification step before commit
- [ ] devorch-builder.md effort guidance references spec contracts
</criteria>
</phase2>
