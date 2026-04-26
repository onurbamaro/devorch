# Plan: Agent Teams Integration

<description>
Integrate Claude Code Agent Teams as a complementary orchestration layer to devorch's existing subagent system. Three fronts: (1) new Agent Teams commands — /devorch:debug, /devorch:review, /devorch:explore-deep; (2) optional Agent Teams modes in existing commands — make-plan auto-escalates for complex tasks, check-implementation gains thorough adversarial mode; (3) shared infrastructure — team templates, feature flag gate, hooks, .devorch/ state integration, cost heuristics.
</description>

<objective>
All three new commands (debug, review, explore-deep) work end-to-end with Agent Teams when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. Existing commands (make-plan, check-implementation) gain --team flag and auto-escalation for complex tasks. All Agent Teams functionality is gated behind the feature flag — existing commands work identically without it. Team templates are configurable via .devorch/team-templates.md with sensible defaults.
</objective>

<classification>
Type: feature
Complexity: complex
Risk: medium
</classification>

<decisions>
Platform mode → In-process always (no tmux/iTerm2 detection)
Output strategy → Hybrid: teammates use messages for coordination + write final results to .devorch/ files
Flag syntax → Boolean --team (team templates define structure per command type)
Auto-escalation threshold → Any complex task auto-escalates to Agent Teams (in make-plan)
Debug team size → Lead + 4 investigators (hypothesis testing)
Review team roles → Security + Quality + Performance + Tests (4 reviewers)
Explore-deep roles → Open-ended goals per teammate (debate emerges naturally), not fixed advocate/critic
Templates location → .devorch/team-templates.md (in-project, versionable)
Feature flag missing → Error with setup instructions (no silent fallback)
Check --team mode → Additional adversarial layer on top of existing Explore agents
Report auto-commit → Yes, all reports auto-commit like other devorch files
</decisions>

<problem-statement>
Devorch currently uses single-context subagents (Task tool) for all parallel work — builders, validators, and Explore agents. This works well for structured build pipelines but lacks the ability to coordinate multi-perspective investigations (debugging), adversarial review (security + quality + perf), or deep architectural exploration with debate between independent analysts. Agent Teams enables multiple independent Claude Code sessions that communicate directly, enabling richer collaboration patterns that subagents can't support.
</problem-statement>

<solution-approach>
**Approach**: Layer Agent Teams on top of existing infrastructure rather than replacing it. New commands use Agent Teams as their primary execution model. Existing commands gain an optional --team mode that adds Agent Teams capabilities without changing the default behavior.

**Architecture**:
1. **Feature flag gate** — A shared utility function `checkAgentTeamsEnabled()` that all team-aware commands call. Returns boolean or errors with setup instructions.
2. **Team templates** — `.devorch/team-templates.md` defines team structure per command type (roles, count, model). Commands read this file and use defaults if missing.
3. **New commands** — Each is a `.md` command file following existing devorch patterns. They spawn teams via TeammateTool, coordinate via messages, and write results to `.devorch/` files.
4. **Existing command integration** — make-plan.md gains a conditional block: if --team flag or complexity=complex, spawn a planning team. check-implementation.md gains a post-verification adversarial review team.
5. **Scripts** — New `check-agent-teams.ts` validates feature flag and team template config. Existing `validate-plan.ts` unchanged.
6. **State integration** — Team session results written to `.devorch/debug-report.md`, `.devorch/review-report.md`, `.devorch/explore-report.md`. Auto-committed.

**Alternatives considered**:
- Replace subagents entirely with Agent Teams → Rejected: Agent Teams has higher token cost, subagents are better for structured build tasks
- Add Agent Teams to build.md → Rejected: Wave-based builder execution works well with subagents, Agent Teams adds cost without benefit for deterministic build tasks
- Store templates in TypeScript → Rejected: Overkill for config, .md is consistent with devorch patterns

**Risks and mitigations**:
- Token cost explosion: Mitigated by gating behind feature flag + only auto-escalating for complex tasks
- Agent Teams API instability (experimental): Mitigated by keeping all existing commands working without it
- Teammate coordination failures: Mitigated by lead agent pattern with timeout handling
- Windows compatibility: Mitigated by using in-process mode exclusively
</solution-approach>

<relevant-files>
- `commands/make-plan.md` — Gains --team flag and auto-escalation logic for complex tasks
- `commands/check-implementation.md` — Gains --team flag for adversarial review layer
- `commands/build.md` — Referenced for existing wave/builder pattern (not modified)
- `agents/devorch-builder.md` — Referenced for agent prompt pattern (not modified)
- `agents/devorch-validator.md` — Referenced for validator pattern (not modified)
- `install.ts` — Must register new commands and scripts in copy targets
- `scripts/validate-plan.ts` — Referenced for validation pattern (not modified)
- `.devorch/CONVENTIONS.md` — Coding conventions for all new code

<new-files>
- `commands/debug.md` — Agent Teams debug command (concurrent hypothesis investigation)
- `commands/review.md` — Agent Teams code review command (adversarial multi-perspective)
- `commands/explore-deep.md` — Agent Teams deep exploration command (architectural debate)
- `scripts/check-agent-teams.ts` — Feature flag validation + team template parsing
- `.devorch/team-templates.md` — Default team templates per command type (generated on first use)
</new-files>
</relevant-files>

<phase1 name="Infrastructure: Feature Flag Gate and Team Templates">
<goal>Create the shared infrastructure that all Agent Teams features depend on — feature flag validation script and team template system.</goal>

<tasks>
#### 1. Create Feature Flag Validation Script
- **ID**: create-check-agent-teams-script
- **Assigned To**: builder-1
- Create `scripts/check-agent-teams.ts` following existing script conventions (Bun APIs, JSON output, no npm deps)
- Script reads `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var
- If set to "1": output `{"enabled": true}`
- If not set or other value: output `{"enabled": false, "instructions": "Set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in your environment or ~/.claude/settings.json env block"}`
- Also parse `.devorch/team-templates.md` if it exists — extract team configs per command type using regex (consistent with existing XML/markdown parsing patterns in validate-plan.ts)
- Output includes `templates` object with parsed team configs (or defaults if file missing)
- Follow conventions: camelCase functions, double quotes, semicolons, 2-space indent, Bun APIs

#### 2. Create Default Team Templates File
- **ID**: create-team-templates
- **Assigned To**: builder-2
- Create `.devorch/team-templates.md` with default team configurations
- Structure: markdown sections per command type (debug, review, explore-deep, make-plan-team, check-team)
- Each section defines: team size (number of teammates), roles (name + focus area), model (default: opus)
- Debug template: 4 investigators, each assigned a hypothesis slot
- Review template: 4 reviewers (security, quality, performance, tests)
- Explore-deep template: 3 explorers with open-ended goals + 1 synthesizer
- Make-plan team template: 2 analysts (scope explorer, risk assessor)
- Check team template: 3 adversarial reviewers (security, quality, performance)
- Format must be parseable by the check-agent-teams.ts regex parser

#### 3. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify `scripts/check-agent-teams.ts` runs successfully with `bun scripts/check-agent-teams.ts`
- Verify it outputs valid JSON with `enabled` and `templates` fields
- Verify `.devorch/team-templates.md` exists with all 5 command templates
- Verify script parses the templates file correctly
</tasks>

<execution>
**Wave 1** (parallel): create-check-agent-teams-script, create-team-templates
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] `scripts/check-agent-teams.ts` exists and outputs JSON with `{enabled, instructions?, templates}` structure
- [ ] Script correctly reads CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var
- [ ] Script parses `.devorch/team-templates.md` and extracts team configs per command type
- [ ] Script returns sensible defaults when team-templates.md is missing
- [ ] `.devorch/team-templates.md` defines templates for all 5 command types (debug, review, explore-deep, make-plan-team, check-team)
- [ ] Both files follow project conventions (camelCase, double quotes, semicolons, Bun APIs)
</criteria>

<validation>
- `bun scripts/check-agent-teams.ts` — outputs valid JSON without errors
- `bun scripts/check-agent-teams.ts | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j.enabled !== undefined && j.templates !== undefined ? 'OK' : 'FAIL')"` — verifies output structure
</validation>

<handoff>
Phase 2 depends on: the check-agent-teams.ts script path and its JSON output format (used by all new commands to gate Agent Teams features and read team templates). The team-templates.md format (section headers and field names) is the contract for template parsing.
</handoff>
</phase1>

<phase2 name="New Commands: debug, review, explore-deep">
<goal>Create the three new Agent Teams command files that spawn teams for investigation, code review, and architectural exploration.</goal>

<tasks>
#### 1. Create Debug Command
- **ID**: create-debug-command
- **Assigned To**: builder-1
- Create `commands/debug.md` following existing command file structure (YAML frontmatter with description, model: opus, argument-hint)
- Workflow:
  1. Read `$ARGUMENTS` (bug description or investigation target)
  2. Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` — if not enabled, error with instructions
  3. Read `.devorch/team-templates.md` for debug template (or use defaults: 4 investigators)
  4. Read `.devorch/CONVENTIONS.md` if exists (context for investigators)
  5. Use Explore agent to understand the affected area and form initial hypotheses
  6. Spawn team via TeammateTool `spawnTeam` operation
  7. Create tasks via TaskCreate — one per hypothesis, assigned to investigators
  8. Investigators explore independently, testing their hypothesis via code analysis
  9. Lead coordinates via `write` messages, redirecting stuck investigators
  10. Collect findings, synthesize into `.devorch/debug-report.md`
  11. Auto-commit: `chore(devorch): debug report — <summary>`
  12. Report findings to user with evidence (file:line references)
- Include rules: no narration, always gate behind feature flag, in-process mode only

#### 2. Create Review Command
- **ID**: create-review-command
- **Assigned To**: builder-2
- Create `commands/review.md` following existing command file structure
- Workflow:
  1. Read `$ARGUMENTS` (file/directory/PR to review, or empty for recent changes)
  2. Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` — if not enabled, error with instructions
  3. Read `.devorch/team-templates.md` for review template (or defaults: 4 reviewers — security, quality, perf, tests)
  4. Determine review scope: if no args, use `git diff --name-only HEAD~1..HEAD` for recent changes
  5. Spawn team via TeammateTool `spawnTeam`
  6. Create tasks via TaskCreate — one per reviewer role, each focused on their lens
  7. Reviewers analyze code independently through their lens (security vulns, code quality, performance issues, test coverage gaps)
  8. Lead collects findings via messages, identifies conflicts/agreements between reviewers
  9. Synthesize into `.devorch/review-report.md` with sections per reviewer + unified recommendations
  10. Auto-commit: `chore(devorch): review report — <scope>`
  11. Report to user with actionable findings
- Include rules: reviewers are READ-ONLY (analysis only, no code changes), always gate behind feature flag

#### 3. Create Explore-Deep Command
- **ID**: create-explore-deep-command
- **Assigned To**: builder-3
- Create `commands/explore-deep.md` following existing command file structure
- Workflow:
  1. Read `$ARGUMENTS` (architectural question or exploration topic)
  2. Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` — if not enabled, error with instructions
  3. Read `.devorch/team-templates.md` for explore-deep template (or defaults: 3 explorers + 1 synthesizer)
  4. Read `.devorch/CONVENTIONS.md` if exists
  5. Break the exploration topic into distinct aspects/sub-questions (one per explorer)
  6. Spawn team via TeammateTool `spawnTeam`
  7. Create tasks via TaskCreate — each explorer gets a distinct aspect
  8. Explorers investigate independently, sharing interesting findings via `write` to other explorers
  9. Synthesizer teammate collects all findings and reconciles conflicting observations
  10. Write `.devorch/explore-report.md` with per-aspect findings + synthesized analysis + architectural recommendations
  11. Auto-commit: `chore(devorch): explore report — <topic>`
  12. Report to user with key findings and recommendations
- Include rules: all exploration is read-only, debate through messages not code changes, gate behind feature flag

#### 4. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verify all three command files exist in `commands/` with correct YAML frontmatter
- Verify each command references `check-agent-teams.ts` for feature flag gating
- Verify each command uses TeammateTool operations (spawnTeam, write)
- Verify each command writes output to `.devorch/` and auto-commits
- Verify commands follow existing command file patterns (sections, rules, agent dispatch)
</tasks>

<execution>
**Wave 1** (parallel): create-debug-command, create-review-command, create-explore-deep-command
**Wave 2** (validation): validate-phase-2
</execution>

<criteria>
- [ ] `commands/debug.md` exists with complete workflow for hypothesis-based investigation using 4 teammates
- [ ] `commands/review.md` exists with complete workflow for adversarial 4-role code review
- [ ] `commands/explore-deep.md` exists with complete workflow for architectural exploration with debate
- [ ] All three commands gate behind CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS via check-agent-teams.ts
- [ ] All three commands read team templates from .devorch/team-templates.md with fallback defaults
- [ ] All three commands write reports to .devorch/ and auto-commit
- [ ] All three commands use TeammateTool operations (spawnTeam, write/broadcast, TaskCreate/TaskUpdate)
- [ ] YAML frontmatter follows convention (description, model: opus, argument-hint where applicable)
</criteria>

<validation>
- `ls commands/debug.md commands/review.md commands/explore-deep.md` — all three files exist
- `grep -l "check-agent-teams" commands/debug.md commands/review.md commands/explore-deep.md` — all reference the feature flag script
- `grep -l "spawnTeam" commands/debug.md commands/review.md commands/explore-deep.md` — all use TeammateTool
</validation>

<handoff>
Phase 3 modifies existing commands. The new commands from this phase serve as reference for how Agent Teams is integrated — same feature flag gate pattern, same template reading pattern. The check-agent-teams.ts script from Phase 1 is the shared dependency.
</handoff>
</phase2>

<phase3 name="Existing Command Integration: make-plan and check-implementation">
<goal>Add optional Agent Teams modes to make-plan (auto-escalation for complex tasks) and check-implementation (adversarial review layer).</goal>

<tasks>
#### 1. Add Agent Teams Mode to make-plan
- **ID**: integrate-make-plan
- **Assigned To**: builder-1
- Modify `commands/make-plan.md` to add Agent Teams escalation
- Changes (additive, no existing behavior modified):
  - After classification step (step 2): if complexity=complex, run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts`
  - If Agent Teams enabled AND (complexity=complex OR --team flag in $ARGUMENTS): enter team planning mode
  - Team planning mode: spawn 2 analyst teammates (from make-plan-team template) — one for scope/architecture exploration, one for risk/dependency analysis
  - Analysts explore in parallel via Agent Teams, report findings via messages
  - Lead synthesizes analyst findings into the exploration cache and uses them for deeper clarification questions
  - Rest of planning workflow continues as normal (clarify, design, create plan)
  - If Agent Teams not enabled and --team flag used: error with setup instructions
  - If Agent Teams not enabled and no --team flag: existing behavior unchanged (subagent Explore)
- Preserve ALL existing workflow steps — Agent Teams is an additional exploration layer, not a replacement

#### 2. Add Agent Teams Mode to check-implementation
- **ID**: integrate-check-implementation
- **Assigned To**: builder-2
- Modify `commands/check-implementation.md` to add adversarial review layer
- Changes (additive, no existing behavior modified):
  - After all existing verification agents complete (after step 3): check for --team flag in $ARGUMENTS
  - If --team flag present: run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts`
  - If Agent Teams enabled: spawn adversarial review team (3 reviewers from check-team template — security, quality, performance)
  - Reviewers receive the combined output from all existing Explore agents + automated checks
  - Each reviewer does a deeper adversarial analysis through their lens
  - Lead collects adversarial findings and appends "Adversarial Review" section to the report
  - If Agent Teams not enabled and --team flag used: error with setup instructions
  - If no --team flag: existing behavior unchanged
- Preserve ALL existing verification workflow — adversarial review is an additional layer after standard checks

#### 3. Validate Phase
- **ID**: validate-phase-3
- **Assigned To**: validator
- Verify make-plan.md still has all original workflow steps intact
- Verify make-plan.md has new Agent Teams conditional block after classification
- Verify check-implementation.md still has all original verification steps intact
- Verify check-implementation.md has new adversarial review conditional block after step 3
- Verify both commands reference check-agent-teams.ts
- Verify --team flag handling is correct (error when flag missing, no change without flag)
</tasks>

<execution>
**Wave 1** (parallel): integrate-make-plan, integrate-check-implementation
**Wave 2** (validation): validate-phase-3
</execution>

<criteria>
- [ ] make-plan.md auto-escalates to Agent Teams when complexity=complex and feature flag is enabled
- [ ] make-plan.md supports explicit --team flag in $ARGUMENTS
- [ ] make-plan.md errors with instructions when --team used but feature flag disabled
- [ ] make-plan.md behavior is identical without --team flag and when task is not complex
- [ ] check-implementation.md adds adversarial review layer when --team flag is present and feature flag enabled
- [ ] check-implementation.md errors with instructions when --team used but feature flag disabled
- [ ] check-implementation.md behavior is identical without --team flag
- [ ] Both commands preserve all existing workflow steps (backward compatible)
</criteria>

<validation>
- `grep -c "check-agent-teams" commands/make-plan.md` — at least 1 reference
- `grep -c "check-agent-teams" commands/check-implementation.md` — at least 1 reference
- `grep -c "--team" commands/make-plan.md` — at least 1 reference
- `grep -c "--team" commands/check-implementation.md` — at least 1 reference
- `bun scripts/validate-plan.ts --plan .devorch/plans/current.md` — plan still valid (meta-check)
</validation>

<handoff>
Phase 4 registers everything in the installer. All command files, the new script, and the templates file must be installable. The install.ts copy targets need updating.
</handoff>
</phase3>

<phase4 name="Installation and Final Integration">
<goal>Update the installer to register all new files and ensure end-to-end installation works.</goal>

<tasks>
#### 1. Update Installer
- **ID**: update-installer
- **Assigned To**: builder-1
- Modify `install.ts` to include new files in copy targets:
  - `commands/debug.md` → `~/.claude/commands/devorch/debug.md`
  - `commands/review.md` → `~/.claude/commands/devorch/review.md`
  - `commands/explore-deep.md` → `~/.claude/commands/devorch/explore-deep.md`
  - `scripts/check-agent-teams.ts` → `~/.claude/devorch-scripts/check-agent-teams.ts`
- The existing install.ts copies all files from `commands/`, `scripts/`, `agents/`, `hooks/` directories — verify the new files are picked up automatically by the glob/directory iteration pattern
- If install.ts uses explicit file lists: add the new files
- If install.ts iterates directories: verify new files are in the correct directories (they should be picked up automatically)
- Do NOT add `.devorch/team-templates.md` to installer — it's a per-project file generated on first use, not a global install artifact
- Run `bun install.ts` to verify installation succeeds
- Verify installed files contain correct `$CLAUDE_HOME` substitutions

#### 2. Create README Section for Agent Teams
- **ID**: update-readme-agent-teams
- **Assigned To**: builder-2
- Add Agent Teams section to existing `README.md` (do not rewrite — add a section)
- Content:
  - Feature flag requirement (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
  - New commands: `/devorch:debug`, `/devorch:review`, `/devorch:explore-deep` with brief descriptions
  - Optional flags: `--team` on make-plan and check-implementation
  - Team templates: explain `.devorch/team-templates.md` customization
  - Note: experimental, requires Agent Teams feature flag

#### 3. Validate Phase
- **ID**: validate-phase-4
- **Assigned To**: validator
- Run `bun install.ts` and verify it completes without errors
- Verify all new command files are installed to `~/.claude/commands/devorch/`
- Verify `check-agent-teams.ts` is installed to `~/.claude/devorch-scripts/`
- Verify `$CLAUDE_HOME` substitution works in all installed .md files
- Verify README.md has Agent Teams section
</tasks>

<execution>
**Wave 1** (parallel): update-installer, update-readme-agent-teams
**Wave 2** (validation): validate-phase-4
</execution>

<criteria>
- [ ] `bun install.ts` installs all new files without errors
- [ ] `debug.md`, `review.md`, `explore-deep.md` installed to `~/.claude/commands/devorch/`
- [ ] `check-agent-teams.ts` installed to `~/.claude/devorch-scripts/`
- [ ] All installed .md files have `$CLAUDE_HOME` replaced with actual path
- [ ] README.md documents Agent Teams commands, flags, and templates
- [ ] Existing devorch commands still install and work (backward compatible)
</criteria>

<validation>
- `bun install.ts` — runs without errors
- `ls ~/.claude/commands/devorch/debug.md ~/.claude/commands/devorch/review.md ~/.claude/commands/devorch/explore-deep.md` — all installed
- `ls ~/.claude/devorch-scripts/check-agent-teams.ts` — script installed
- `grep "CLAUDE_HOME" ~/.claude/commands/devorch/debug.md` — should find NO literal $CLAUDE_HOME (all substituted)
</validation>
</phase4>
