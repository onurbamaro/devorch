# Plan: Ecosystem Enhancements — Self-fix, Devil's Advocate, TLDR Analysis, Directed Artifacts

<description>
Implement 4 high-value ideas from ecosystem research: formalized self-fix retry loop with budget,
adversarial Devil's Advocate during planning, TLDR code analysis via ts-morph for builder context
enrichment, and directed knowledge artifacts via explore-queries per phase.
</description>

<objective>
All 4 features integrated into the devorch pipeline: builders retry up to 3 times with error context,
talk phase includes adversarial plan challenge before execution, builders receive structural code
summaries from ts-morph analysis, and plans can specify directed exploration queries consumed during build.
</objective>

<classification>
Type: feature
Complexity: complex
Risk: medium
</classification>

<decisions>
TLDR scope → TypeScript-only via ts-morph (new dependency OK)
TLDR output → complements explore-cache as separate "Code Structure" section in builder context
TLDR timing → init-phase.ts calls on-demand per phase (like map-project.ts)
Directed artifacts → explore-queries field per phase in plan, consumed during build conditional explore
Self-fix retries → 3 fixed retries (not configurable), error context + diff of failed changes
DA timing → after Step 6 (design), before creating plan
DA scope → implicit assumptions, wave/task conflicts, spec completeness, regression risks
DA interaction → show findings, user chooses: adjust design, ignore, cancel
Priority → Self-fix → DA → TLDR → Directed (phased by file dependencies)
</decisions>

<problem-statement>
devorch has 4 gaps identified from ecosystem research: (1) builders get only 1 retry on failure causing
silent phase failures, (2) no adversarial challenge of plan design before execution, (3) builder context
lacks structural code analysis (only filesystem metadata), (4) exploration queries are generic rather than
directed by plan needs.
</problem-statement>

<solution-approach>
Phase 1 addresses pipeline robustness (self-fix + DA) by modifying build.md and talk.md.
Phase 2 adds context enrichment (TLDR + directed artifacts) via new script, init-phase integration,
and plan format extension. Phases are separated because both modify talk.md and build.md — Phase 2
builds on Phase 1's committed changes.
</solution-approach>

<relevant-files>
- `commands/build.md` — builder deployment, retry logic, phase validation
- `commands/talk.md` — talk pipeline steps, inline path, plan format spec
- `scripts/init-phase.ts` — phase context assembly, cache/convention/spec filtering
- `scripts/validate-plan.ts` — plan structure validation
- `scripts/lib/plan-parser.ts` — shared parsing utilities for plans
- `package.json` — dependencies (adding ts-morph)
- `agents/devorch-builder.md` — builder prompt structure (reference only)

<new-files>
- `scripts/tldr-analyze.ts` — TypeScript structural analysis via ts-morph
</new-files>
</relevant-files>

<phase1 name="Self-fix Loop and Devil's Advocate">
<goal>Formalize builder retry logic with 3 attempts and add adversarial plan challenge to talk pipeline</goal>

<spec>
<behavior name="builder-retry-loop">
  <precondition>Builder task fails: no TaskUpdate(completed) OR no matching commit in git log</precondition>
  <postcondition>
    Retry up to 3 times. Each retry includes:
    - Original task context unchanged
    - Error message from previous attempt (last 50 lines of builder output)
    - Git diff of failed changes (if any commits exist)
    After 3 failures: stop phase, report to user with full error context and suggestion
  </postcondition>
</behavior>

<invariant>Retry counter tracks per-task across the phase — resets only on new phase</invariant>

<behavior name="devils-advocate-challenge">
  <precondition>Solution design (step 6) complete: specs, approach, relevant files, exploration findings available</precondition>
  <postcondition>
    Explore agent launched with adversarial mandate returning structured findings.
    Findings displayed to user in 4 categories.
    User prompted: "Ajustar design" (return to step 6), "Ignorar — seguir" (proceed to step 7), "Cancelar".
  </postcondition>
</behavior>

<interface name="da-agent-prompt">
  <input>Solution approach, proposed specs, relevant-files list, explore-cache findings, CONVENTIONS.md content</input>
  <output>
    Structured findings in 4 categories:
    - Implicit assumptions: design takes for granted things that may not hold
    - Wave/task conflicts: shared file risks, hidden dependencies between parallel tasks
    - Spec gaps: missing error cases, undefined edge behaviors, incomplete contracts
    - Regression risks: existing functionality that may break, with file evidence
  </output>
  <error case="no-findings">Report "No significant issues found" — do not fabricate</error>
</interface>
</spec>

<tasks>
#### 1. Self-fix Retry Loop in Build Command
- **ID**: self-fix-build
- **Assigned To**: devorch-builder
- **Effort**: medium
- **Spec refs**: builder-retry-loop
- Update the "On builder failure" section in `commands/build.md` to support 3 retries (up from 1)
- Each retry must include in the re-launched builder prompt: error message from previous attempt (last 50 lines of Task result output), git diff of changes made by the failed builder (if any commits)
- After 3 failures: stop phase, report structured failure with all retry context
- Update the retry counter logic: track per-task-id, not per-wave
- Ensure the feedback logging section covers retry exhaustion as a trigger

#### 2. Devil's Advocate Step and Inline Retry in Talk Command
- **ID**: da-and-inline-retry
- **Assigned To**: devorch-builder
- **Effort**: high
- **Spec refs**: devils-advocate-challenge, da-agent-prompt, builder-retry-loop
- Add Step 6b "Devil's Advocate" in `commands/talk.md` between Step 6 (Design solution) and Step 7 (Create plan):
  - Launch 1 Explore agent (Agent tool with subagent_type="Explore", thoroughness "very thorough") with adversarial mandate
  - Agent receives: solution approach, proposed specs, relevant-files, explore-cache content, CONVENTIONS.md
  - Agent must investigate and report on 4 categories: implicit assumptions, wave/task conflicts, spec gaps, regression risks
  - Display findings as structured report in chat using plain markdown (headers, lists, bold — no box-drawing)
  - Use AskUserQuestion with options: "Ajustar design" → return to Step 6 with DA findings as additional input, "Ignorar — seguir" → proceed to Step 7, "Cancelar" → stop
  - If no significant findings, report that and proceed automatically (no user prompt needed)
- Also update Step 8i.b inline path builder failure handling to match build.md: 3 retries with error context + diff (same spec as self-fix-build task, applied to the inline path section)
- Update inline path Step 8i.b to say "After 3 retries" instead of "After 1 retry"
</tasks>

<execution>
**Wave 1** (parallel): self-fix-build, da-and-inline-retry
</execution>

<criteria>
- [ ] build.md supports 3 retries per task with error context and diff
- [ ] talk.md has Devil's Advocate step between design and plan creation
- [ ] talk.md inline path has 3 retries matching build.md behavior
- [ ] DA agent prompt covers all 4 finding categories
- [ ] DA findings trigger user interaction with adjust/ignore/cancel options
</criteria>

<handoff>
build.md and talk.md now have self-fix retry logic (3 attempts) and DA challenge step.
Phase 2 will modify these files again to add TLDR builder context and directed explore queries.
</handoff>
</phase1>

<phase2 name="TLDR Code Analysis and Directed Knowledge Artifacts">
<goal>Add ts-morph structural analysis for builder context and directed exploration queries per phase</goal>

<spec>
<interface name="tldr-analyze-script">
  <input>--files path1,path2,... [--root projectRoot]</input>
  <output>
    JSON stdout: {
      files: { [path]: {
        exports: [{ name: string, kind: "function"|"class"|"type"|"interface"|"const"|"enum", signature?: string }],
        imports: [{ from: string, names: string[] }],
        functions: [{ name: string, params: string, returnType: string, isAsync: boolean, isExported: boolean }],
        types: [{ name: string, kind: "type"|"interface"|"enum", members?: string[] }]
      }},
      warnings: string[],
      tokenEstimate: number
    }
  </output>
  <error case="no-ts-files">Exit 0, { files: {}, warnings: ["No TypeScript files found"], tokenEstimate: 0 }</error>
  <error case="parse-failure">Skip file, add to warnings: "Failed to parse: path (reason)"</error>
</interface>

<behavior name="init-phase-tldr-integration">
  <precondition>Phase relevant-files contain .ts or .tsx files</precondition>
  <postcondition>
    init-phase.ts calls tldr-analyze.ts subprocess with relevant .ts/.tsx files from phase.
    Output JSON includes codeStructureByTask: { [taskId]: string } with markdown-formatted
    TLDR filtered per task by file refs (same pattern as cacheByTask filtering).
  </postcondition>
</behavior>

<behavior name="builder-receives-tldr">
  <precondition>codeStructureByTask[taskId] exists and is non-empty</precondition>
  <postcondition>Builder prompt includes "## Code Structure" section between conventions and cache</postcondition>
</behavior>

<interface name="explore-queries-plan-format">
  <input>Phase XML with optional explore-queries section</input>
  <output>
    Plan format — placed after spec, before tasks in phase:
    explore-queries section containing lines of format:
    - "directive query text" — for task-id
    Each query: quoted directive string + " — for task " + task-id
  </output>
</interface>

<behavior name="directed-explore-in-build">
  <precondition>init-phase output contains exploreQueries array (non-empty)</precondition>
  <postcondition>
    build.md conditional explore launches Explore agents with directed queries as prompts.
    Results appended to explore-cache with headers matching query subjects.
    Cache re-filtered per task after directed explore completes.
  </postcondition>
</behavior>

<behavior name="validate-explore-queries">
  <precondition>Plan phase contains explore-queries section</precondition>
  <postcondition>
    validate-plan.ts checks: queries reference existing task-ids from the phase,
    queries are non-empty strings, duplicate queries warn.
    Missing section is OK (optional).
  </postcondition>
</behavior>
</spec>

<tasks>
#### 1. Add ts-morph Dependency
- **ID**: add-ts-morph-dep
- **Assigned To**: devorch-builder
- **Model**: sonnet
- **Effort**: low
- Add `ts-morph` to dependencies in `package.json` (not devDependencies — it's used by scripts at runtime)
- Run `bun install` to update `bun.lock`

#### 2. TLDR Code Analysis Script
- **ID**: tldr-analyze-script
- **Assigned To**: devorch-builder
- **Effort**: high
- **Spec refs**: tldr-analyze-script
- Create `scripts/tldr-analyze.ts` implementing the spec interface
- Use ts-morph Project to parse TypeScript files (use `skipAddingFilesFromTsConfig: true`, `skipFileDependencyResolution: true` for speed)
- For each file: extract exports (name, kind, signature), imports (from, names), functions (name, params, returnType, isAsync, isExported), types (name, kind, members)
- Accept `--files` (comma-separated paths) and `--root` (base path for resolution, defaults to cwd)
- Output JSON to stdout, errors/warnings to stderr
- Follow devorch script patterns: arrow helpers at top, imperative main logic, Bun APIs, double quotes, semicolons
- Token estimate: count total characters in stringified output / 4

#### 3. Explore Queries Format and Validation
- **ID**: explore-queries-format
- **Assigned To**: devorch-builder
- **Effort**: medium
- **Spec refs**: explore-queries-plan-format, validate-explore-queries
- In `commands/talk.md` Plan Format section: add `<explore-queries>` as optional section in phase template (after `<spec>`, before `<tasks>`). Document the format: each line is `- "query text" — for task-id`
- In `commands/talk.md` Plan Format Rules: add `<explore-queries>` to "Inside phase" list as optional
- In `commands/talk.md` Step 6: add note about generating directed queries when the design identifies areas needing deeper build-time exploration
- In `scripts/validate-plan.ts`: add validation for `<explore-queries>` — parse each query line, validate task-id references exist in phase tasks, warn on duplicates, ensure non-empty query text. Use regex parsing consistent with existing validation patterns
- In `scripts/lib/plan-parser.ts`: add exported `extractExploreQueries(phaseContent: string): Array<{query: string, taskId: string}>` function

#### 4. Init-phase TLDR Integration and Build Consumption
- **ID**: init-phase-tldr-and-build
- **Assigned To**: devorch-builder
- **Effort**: high
- **Spec refs**: init-phase-tldr-integration, builder-receives-tldr, directed-explore-in-build
- In `scripts/init-phase.ts`:
  - Extract .ts/.tsx file paths from phase relevant-files (regex backtick extraction, filter by extension)
  - Call `scripts/tldr-analyze.ts` as subprocess with `--files` and `--root` (same Bun.spawn pattern as map-project.ts call)
  - Parse JSON output, format each file's analysis as markdown section
  - Add `codeStructureByTask: Record<string, string>` to output JSON — filter TLDR per task by file refs (same filterCacheByRefs pattern)
  - Extract `<explore-queries>` from phase content using plan-parser's `extractExploreQueries()`, add `exploreQueries` array to output JSON
- In `commands/build.md`:
  - In builder prompt composition: add `codeStructureByTask[taskId]` as "## Code Structure" section (after conventions, before cache)
  - In conditional explore step: if `exploreQueries` array present and non-empty in init-phase output, launch Explore agents with directed query prompts instead of generic exploration. Append results to explore-cache
</tasks>

<execution>
**Wave 1** (parallel): add-ts-morph-dep, tldr-analyze-script, explore-queries-format
**Wave 2** (after wave 1): init-phase-tldr-and-build
</execution>

<criteria>
- [ ] ts-morph installed and listed in package.json dependencies
- [ ] tldr-analyze.ts produces correct JSON for TypeScript files following the spec interface
- [ ] tldr-analyze.ts handles parse errors gracefully (skip + warn)
- [ ] init-phase.ts output includes codeStructureByTask with per-task filtered TLDR
- [ ] init-phase.ts output includes exploreQueries when phase has explore-queries section
- [ ] build.md passes Code Structure to builders in prompt
- [ ] build.md uses directed queries in conditional explore when available
- [ ] validate-plan.ts validates explore-queries format and task-id references
- [ ] talk.md plan format documents explore-queries section
- [ ] plan-parser.ts exports extractExploreQueries function
</criteria>
</phase2>
