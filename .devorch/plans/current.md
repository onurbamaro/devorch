# Plan: Streamline Phase Checks and Simplify Exploration

<description>
Three changes to devorch:
1. Per-phase checks run only build + typecheck with 10s timeout (--quick flag). Single-phase plans skip per-phase check entirely.
2. Remove the validation tag from plan format, check-project.ts, and all references across commands/docs.
3. Simplify exploration from manual "Agent Teams" with template/dynamic role composition to direct Explore agent calls with focused prompts and thoroughness levels.
</description>

<objective>
Per-phase checks complete in ≤10s running only build+typecheck. The validation tag no longer exists in the plan format or any script/command. Exploration instructions use native Explore agent syntax (Agent tool with subagent_type="Explore") without template teams or dynamic team composition. All docs and README reflect the new behavior.
</objective>

<classification>
Type: Refactor
Complexity: Medium
Risk: Low
</classification>

<decisions>
- Per-phase check scope → only build + typecheck, 10s timeout
- Single-phase plans → skip per-phase check, only run final complete check
- Validation tag → remove entirely from plan format, scripts, and commands
- Exploration approach → 2-3 Explore agents with focused prompts (no role-playing/team templates), reviewers kept as-is
- fix.md → also migrated to simplified exploration
- explore-cache.md → keep caching mechanism
- Docs → update both README.md and build-phase-reference.md
</decisions>

<problem-statement>
Per-phase validation runs all 4 checks (lint, typecheck, build, test) with 60-120s timeouts, adding unnecessary overhead between phases. The validation tag in plans adds noise without blocking value (failures are warnings only). Exploration instructions are complex with template teams, dynamic teams, and role-playing prompts that add orchestrator overhead without improving the native Explore agent's search quality.
</problem-statement>

<solution-approach>
1. Add --quick flag to check-project.ts: runs only build + typecheck with 10s timeout, skips lint and test entirely. Remove all validation-related code (--with-validation, parseValidationCommands, runValidation, ValidationResult, ValidationOutput, VALIDATION_TIMEOUT_MS).
2. Update build.md step 2d to use --quick for per-phase checks, skip entirely for single-phase plans, and remove all validation references.
3. Replace talk.md Step 2 "Explore with Agent Teams" with simplified "Explore" section using direct Agent tool calls with focused prompts.
4. Simplify fix.md Step 3 to use Agent tool syntax instead of "Task with subagent_type" pattern.
5. Update plan format to remove validation tag. Update validate-plan.ts to not require it.
6. Update all docs and agent definitions for consistency.
</solution-approach>

<relevant-files>
- `scripts/check-project.ts` — add --quick flag, remove all validation code
- `scripts/validate-plan.ts` — remove validation from required phase tags (line 112)
- `commands/build.md` — per-phase --quick, skip for 1-phase, remove validation refs, update --no-tests description
- `commands/talk.md` — remove validation from plan format, simplify Step 2 exploration, update tool references
- `commands/fix.md` — simplify Step 3 investigation, update tool references
- `agents/devorch-builder.md` — update Task→Agent tool reference for Explore
- `README.md` — update feature descriptions, script description, YAML section
- `docs/build-phase-reference.md` — remove validation references from archived doc
</relevant-files>

<phase1 name="Core Scripts and Commands">
<goal>Update check-project.ts with --quick flag and no validation, update validate-plan.ts, and update all three command files (build.md, talk.md, fix.md).</goal>

<tasks>
#### 1. Add --quick flag and remove validation from check-project.ts
- **ID**: quick-flag-check-project
- **Assigned To**: builder-scripts-check
- Add `--quick` flag parsing (alongside existing `--no-test`, `--timeout`)
- When `--quick` is set:
  - Only run `build` and `typecheck` checks (skip `lint` and `test` entirely, mark them as `"skip"`)
  - Override timeout to 10_000ms (10 seconds) for both checks, ignoring any `--timeout` value
  - Do NOT run validation (validation is being removed entirely)
- Remove ALL validation-related code:
  - Remove flag parsing: `--with-validation`, `--plan`, `--phase` flags and their variables (`withValidation`, `planPath`, `phaseNum`)
  - Remove constants: `VALIDATION_TIMEOUT_MS`
  - Remove interfaces: `ValidationResult`, `ValidationOutput`
  - Remove functions: `parseValidationCommands`, `extractWorkingDirs`, `lastNLines`, `determineCwd`, `runValidationCommand`, `runValidation`
  - Remove validation execution: `validationPromise` conditional and `output.validation` assignment
  - Remove imports: `extractTagContent`, `parsePhaseBounds`, `readPlan` from `./lib/plan-parser` (only used by validation code)
- Update file header comment to remove `--with-validation` usage line and add `--quick` usage
- Keep: `--no-test`, `--timeout` flags, all 4 check definitions (lint, typecheck, build, test), `runCheck` function, package.json detection, package manager detection

#### 2. Remove validation from required phase tags in validate-plan.ts
- **ID**: remove-validation-validate-plan
- **Assigned To**: builder-scripts-validate
- In the `phaseRequired` array (around line 107-113), remove the entry: `{ pattern: /<validation>[\s\S]*?<\/validation>/i, name: "validation" }`
- Keep all other required tags: goal, tasks, execution, criteria

#### 3. Update build.md for quick per-phase checks and remove validation
- **ID**: update-build-md
- **Assigned To**: builder-cmd-build
- **Step 0 (--no-tests description, around line 16)**: Remove the sentence "Per-phase tests always run regardless of this flag." since per-phase checks no longer run tests
- **Step 2d (Validate phase code, lines 97-120)**: Replace the entire section with new logic:
  - Add condition: if `totalPhases == 1`, skip per-phase check entirely (the final check in step 3c covers everything)
  - If `totalPhases > 1`: run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick` (no --with-validation, --plan, --phase flags)
  - Simplify result evaluation: only build and typecheck can fail (lint and test are skipped). If either fails, fix errors and retry once. If still failing, report and block the phase.
  - Remove all validation.failed logic and validation field description
  - **Satellite per-phase checks**: also use `--quick` instead of the current `--no-test` approach. Change `bun check-project.ts <satellite.worktreePath> --no-test` to `bun check-project.ts <satellite.worktreePath> --quick`
  - Update the "Check-project overlap with next phase" note to reference --quick
- **Step 3c (Post-review check, lines 219-232)**: No functional changes — keeps running the full check-project.ts. Just verify no --with-validation references remain.

#### 4. Simplify exploration and remove validation from plan format in talk.md
- **ID**: update-talk-md
- **Assigned To**: builder-cmd-talk
- **Description frontmatter (line 2)**: Change `"Conversa + exploração com Agent Teams + plano estruturado"` to `"Conversa + exploração + plano estruturado"`
- **Step 1 (CONVENTIONS.md generation, lines 55-58)**: Replace `"Launch 1-2 Explore agents (use the **Task tool call** with subagent_type="Explore")"` with `"Launch 1-2 Explore agents (Agent tool with subagent_type="Explore", thoroughness "very thorough")"`
- **Step 2 (lines 82-125)**: Replace the entire "Explore with Agent Teams" section with a simplified "Explore" section:
  - New title: `### 2. Explore`
  - Remove: template teams table (lines 86-93), dynamic team composition think-through block (lines 95-109)
  - New content: `Analyze $ARGUMENTS and determine 2-3 distinct exploration focuses relevant to the task. Consider: architecture/integration, risks/edge cases, existing patterns/conventions.` Then: `Launch 2-3 Explore agents (Agent tool with subagent_type="Explore") in parallel in a single message. Each agent receives: a specific focus area (distinct from other agents), $ARGUMENTS, CONVENTIONS.md content (if it exists). Use thoroughness "very thorough" for the primary exploration.`
  - Keep: effort guidance line, explore-cache.md output format block
- **Step 4 (Deep exploration, lines 159-163)**: Replace `"Use the **Task tool call** with subagent_type="Explore""` with `"Use the Agent tool with subagent_type="Explore""`
- **Plan Format (lines 351-353)**: Remove the entire validation block from the phase template
- **Plan Format Rules (line 375)**: Remove `<validation>` from the "Inside phase" list. New list: `<goal>`, `<tasks>`, `<execution>`, `<criteria>`, `<test-contract>` (optional), `<handoff>` (except last phase)
- **Phase consolidation guidance (line 194)**: Change "Phase A's validation must pass" to "Phase A's checks must pass"
- **Rules (lines 382-387)**: Replace `"Use the **Task tool call** with subagent_type="Explore""` with `"Use the Agent tool with subagent_type="Explore""`. Change `"No Task agents except Explore"` to `"No agents except Explore"`

#### 5. Simplify exploration references in fix.md
- **ID**: update-fix-md
- **Assigned To**: builder-cmd-fix
- **Description frontmatter (line 2)**: Change `"Fix/debug pontual com investigação Agent Teams"` to `"Fix/debug pontual com investigação"`
- **Line 7**: Change `"Targeted fix/debug with Agent Teams investigation"` to `"Targeted fix/debug with investigation"`
- **Step 3 title (line 43)**: Change `"Investigate with Agent Teams"` to `"Investigate"`
- **Step 3 (line 47)**: Replace `"Launch 2-3 parallel Explore agents (Task with subagent_type="Explore")"` with `"Launch 2-3 Explore agents (Agent tool with subagent_type="Explore") in parallel"`
- **Step 6 (line 71)**: Replace `"Task with subagent_type="Explore", foreground, parallel"` with `"Agent tool with subagent_type="Explore", foreground, parallel"`
- Keep: hypothesis-based investigation structure, conditional review logic, all other content unchanged

</tasks>

<execution>
**Wave 1** (parallel): quick-flag-check-project, remove-validation-validate-plan, update-build-md, update-talk-md, update-fix-md
</execution>

<criteria>
- [ ] check-project.ts --quick runs only build+typecheck with 10s timeout
- [ ] check-project.ts has zero validation-related code
- [ ] validate-plan.ts does not require validation tag in phases
- [ ] build.md step 2d uses --quick for multi-phase plans, skips for single-phase
- [ ] build.md has zero references to --with-validation or validation.failed
- [ ] talk.md plan format has no validation tag
- [ ] talk.md Step 2 has no template teams or dynamic team composition
- [ ] talk.md uses "Agent tool" not "Task tool call" for Explore references
- [ ] fix.md uses "Agent tool" not "Task" for Explore references
- [ ] fix.md has no "Agent Teams" in titles or descriptions
</criteria>

<handoff>
Core scripts and all 3 commands updated. Phase 2 updates README, archived docs, and builder agent definition to be consistent with the new behavior.
</handoff>
</phase1>

<phase2 name="Documentation and Agent Updates">
<goal>Update README.md, build-phase-reference.md, and devorch-builder.md to reflect the new check behavior, removed validation, and simplified exploration.</goal>

<tasks>
#### 1. Update README.md
- **ID**: update-readme
- **Assigned To**: builder-docs-readme
- **Line 19 (Automatic validation feature)**: Change `"Every phase runs lint, typecheck, and validation commands in parallel. The final build step adds adversarial review with specialized agents (security, quality, completeness). Bugs surface immediately."` to `"Every phase runs a quick build + typecheck check (10s). The final build step runs the complete suite (lint, typecheck, build, tests) plus adversarial review with specialized agents (security, quality, completeness). Bugs surface immediately."`
- **Line 88 (talk description)**: Change `"Launches parallel Explore agents with specialized roles (architecture, risk, patterns)"` to `"Launches parallel Explore agents to investigate the codebase"`
- **Line 107 (check-project.ts in Scripts table)**: Change `"Runs lint + typecheck + build + test in parallel. With --with-validation, also runs phase validation commands. Returns JSON."` to `"Runs lint + typecheck + build + test in parallel. With --quick, runs only build + typecheck (10s). Returns JSON."`
- **Line 135 (Commands Reference, talk)**: Change `"Explore (Agent Teams)"` to `"Explore"`
- **Line 182 (YAML capabilities)**: Change `"Automatic phase validation (lint, typecheck, build, tests)"` to `"Quick per-phase checks (build, typecheck) with full validation at end"`
- **Line 185 (YAML capabilities)**: Change `"Codebase exploration via parallel Agent Teams"` to `"Codebase exploration via parallel Explore agents"`
- **Line 193 (YAML talk purpose)**: Change `"Conversation, exploration, and planning with Agent Teams"` to `"Conversation, exploration, and planning with Explore agents"`
- **Line 212 (YAML check-project)**: Change `"check-project.ts (lint + typecheck + build + test + validation)"` to `"check-project.ts (lint + typecheck + build + test; --quick for per-phase)"`

#### 2. Update build-phase-reference.md
- **ID**: update-build-phase-ref
- **Assigned To**: builder-docs-ref
- **Line 47**: Change `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --with-validation --plan .devorch/plans/current.md --phase N` to `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`
- **Lines 50-52**: Remove the validation field description and validation.failed logic. Replace with: `"The JSON output includes build and typecheck fields (lint and test are skipped with --quick). If build/typecheck fail: fix ALL errors. If unable to fix after one retry, report and block."`
- **Line 61**: Remove `"Note: satellite checks do NOT use --with-validation — only lint, typecheck, and build."` Replace with `"Satellite checks also use --quick — only build and typecheck."`

#### 3. Update devorch-builder.md Explore reference
- **ID**: update-builder-agent
- **Assigned To**: builder-docs-agent
- **Line 19**: Change `"use \`Task\` with \`subagent_type=Explore\` to gather what you need before writing code. Launch multiple Explore agents in parallel when exploring independent areas."` to `"use the Agent tool with \`subagent_type=\"Explore\"\` to gather what you need before writing code. Launch multiple Explore agents in parallel when exploring independent areas."`

</tasks>

<execution>
**Wave 1** (parallel): update-readme, update-build-phase-ref, update-builder-agent
</execution>

<criteria>
- [ ] README.md describes quick per-phase checks, not full validation
- [ ] README.md has no "Agent Teams" references
- [ ] README.md check-project.ts description mentions --quick instead of --with-validation
- [ ] build-phase-reference.md uses --quick, no --with-validation
- [ ] devorch-builder.md uses "Agent tool" for Explore, not "Task"
</criteria>
</phase2>
