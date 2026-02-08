---
description: Creates a phased implementation plan with team orchestration
argument-hint: <description of what to build/change>
model: opus
disallowed-tools: EnterPlanMode
---

Create a phased implementation plan for the project.

**Input**: $ARGUMENTS (description of what to build/change). If empty, stop and ask the user.

## Steps

### 1. Load context

**Project data**: Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` to collect tech stack, folder structure, dependencies, and scripts. Use this output as inline context for planning — do not save it to a file. Additionally, read `.devorch/PROJECT.md` if it exists (product context from `/devorch:new-idea`). If the script fails (no Bun, etc.), gather equivalent data via an Explore agent.

**Conventions**: Read `.devorch/CONVENTIONS.md`.

- **If missing**: Generate it now. Launch 1-2 `Task` agents with `subagent_type=Explore` to investigate:
  - **Architectural patterns** — how services/modules are structured, DI, middleware chains, state management, error handling patterns
  - **Active workarounds** — patterns builders must preserve and why (e.g., "json-bigint used because IDs exceed MAX_SAFE_INTEGER")
  - **Gotchas** — things a builder needs to know to avoid mistakes

  Write `.devorch/CONVENTIONS.md` from Explore findings using this format:

  ```markdown
  # Code Conventions

  ## Patterns
  <component structure, service patterns, state management, error handling — from Explore findings>

  ## Active Workarounds
  <workarounds builders must preserve, and why they exist>
  (skip section if none found)

  ## Gotchas
  <things a builder needs to know to avoid mistakes>
  ```

  **Sampling rule:** When a section has many files (50+ components, 20+ routes), read 3-5 representative files to identify the pattern. Stop when the pattern is clear.

- **If exists**: Quick staleness check — compare library names mentioned in CONVENTIONS.md against current `package.json` dependencies. If CONVENTIONS.md references libraries no longer in package.json (or major new dependencies aren't reflected), regenerate it using the process above.

If `.devorch/plans/current.md` exists:
- Read `.devorch/state.md`. If state shows the plan is `completed` (or last completed phase equals total phase count in current.md), archive silently — move current.md to `.devorch/plans/archive/<timestamp>-<plan-name>.md` (create archive dir if needed). No need to ask.
- Otherwise, ask the user if they want to archive it (in-progress plan, may lose work).

### 2. Classify

Determine before exploring:

- **Type**: `feature` | `fix` | `refactor` | `migration` | `chore` | `enhancement`
- **Complexity**: `simple` (1-2 files) | `medium` (3-10 files, some design) | `complex` (10+ files, architecture/compatibility)
- **Risk**: `low` (additive) | `medium` (modifies behavior, shared code) | `high` (runtime/build/deps, compatibility, data)

### 3. Agent Teams exploration (conditional)

Run `bun $CLAUDE_HOME/devorch-scripts/check-agent-teams.ts` and parse the JSON output.

Check if `--team` flag is present in `$ARGUMENTS`.

**Conditional logic:**

- If `--team` flag is present AND Agent Teams is NOT enabled (`enabled: false`): stop and display the `instructions` field to the user. Do not proceed.
- If Agent Teams IS enabled AND (`--team` flag is present OR complexity is `complex`): enter Agent Teams planning mode (below).
- Otherwise: skip this step entirely — existing behavior unchanged.

**Agent Teams planning mode:**

Read `.devorch/team-templates.md` and extract the `make-plan-team` template. If missing or unparseable, use defaults: 2 analysts, model opus.

Spawn a team using `TeammateTool` `spawnTeam` with 2 analysts from the template:
- **scope-explorer**: Explores codebase to understand scope, dependencies, and impact of the requested change
- **risk-assessor**: Identifies risks, edge cases, and potential blockers

Analysts explore in parallel via Agent Teams and report findings via messages. Lead synthesizes analyst findings into additional context for the explore cache and uses them to generate deeper, more informed clarification questions in step 5.

After the team completes, continue with step 4 — the Agent Teams exploration supplements, not replaces, the existing Explore agents.

### 4. Initial exploration

Before asking the user anything, understand the codebase. Launch Explore agents to map the affected areas — structure, patterns, constraints, edge cases. This ensures questions are informed, not guesses.

Use `Task` agents with `subagent_type=Explore`. Scale to complexity:

- **Simple** — One Explore agent to skim the affected area.
- **Medium** — Parallel Explore agents: one per affected area.
- **Complex** — Parallel Explore agents covering every affected area + dependency check.

### 5. Clarify with the user (never skip)

Use `AskUserQuestion` to eliminate **every** ambiguity, gray area, and open question before planning. Each question must have 2-4 clickable options (the user can always type a custom answer). This step prevents expensive rework later — an unanswered question now becomes a wrong assumption in the plan.

**This step is mandatory.** Even if the request seems clear, the initial exploration will reveal decisions that need user input — approach choices, scope boundaries, behavior in edge cases. Ask about those.

**What to ask about** (cover ALL that apply — no artificial limit on number of questions):

- **Scope** — Does the user want just X, or also Y? Should it handle edge case Z?
- **Approach** — When multiple architectures or patterns are viable, which does the user prefer?
- **Constraints** — Backward compatibility? Performance targets? Specific libraries to use or avoid?
- **Behavior** — What should happen on error? What's the UX for edge cases?
- **Priority** — Speed vs completeness? MVP vs full implementation?
- **Integration** — Should this connect to existing feature X? Replace or extend current behavior?
- **Naming / conventions** — When the codebase doesn't have a clear precedent for something, ask.
- **Edge cases** — Anything the exploration revealed that has no obvious right answer.

**Ask in rounds.** Use up to 4 questions per `AskUserQuestion` call (tool limit). If more questions remain, make another call after the user answers. Continue until all ambiguity is resolved — there is no cap on rounds. The goal is **zero assumptions** in the plan.

**Guidelines:**
- Use short, concrete options — not vague ones like "Option A" / "Option B". Each option should describe a real choice (e.g., "JWT with refresh tokens", "Session-based with Redis").
- Front-load the recommended option and append "(Recommended)" to its label.
- Ground questions in what the exploration found — reference real files, patterns, or constraints discovered.
- Don't ask what the codebase or conventions already answer.
- Don't ask the user to make decisions you're better equipped to make (pure implementation details).

### 6. Deep exploration (informed by user answers)

If user answers revealed new areas to explore, or if the initial exploration was shallow, launch additional Explore agents now — targeted by the user's choices.

Use `Task` agents with `subagent_type=Explore` for all codebase exploration. **Do NOT read source files directly** — use Explore agent summaries as your evidence base. Use Grep directly only for quantification (counting imports, usage patterns).

**Evidence-based planning**: every task must reference real files discovered by Explore agents, not assumptions. Quantify: "Update 14 files that import from X", not "Update files".

**Cache exploration results**: After all Explore agents return (from both step 4 and step 6), write `.devorch/explore-cache.md` with the combined summaries:

```markdown
# Explore Cache
Generated: <ISO timestamp>

## <area-name-1>
<Explore agent summary for this area>

## <area-name-2>
<Explore agent summary for this area>
```

This cache is reused by `/devorch:build` to avoid re-exploring the same areas. Each section title should match the area explored (e.g., "Auth module", "API routes", "Database layer").

### 7. Design solution (medium/complex only)

Think through: core problem, approach, alternatives considered, risks and mitigations.

### 8. Create plan

Write `.devorch/plans/current.md` following the **Plan Format** below.

### 9. Validate

Run `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan .devorch/plans/current.md`. Fix issues if blocked.

### 10. Reset state

Delete `.devorch/state.md` and `.devorch/state-history.md` if they exist — a new plan means fresh state. Previous plan's progress is irrelevant.

### 11. Auto-commit

Stage and commit all devorch files modified in this session:
- Stage `.devorch/plans/current.md`, `.devorch/explore-cache.md` (if created), `.devorch/CONVENTIONS.md` (if created/updated)
- If state.md or state-history.md were deleted, stage those deletions too
- Format: `chore(devorch): plan — <descriptive plan name>`

### 12. Report

Show classification, phases with goals, wave structure, then instruct: `/devorch:build`. Mention that `/devorch:check-implementation` runs automatically at the end of build.

## Parallelization Rules

Maximize parallel execution without losing quality:

- **Break work into independent units.** If a large task can be split into two tasks that touch different files, split it.
- **Group independent tasks into the same wave.** All tasks in a wave run as parallel agents.
- **Only create sequential waves when truly necessary**: task B reads output of task A, or both modify the same file.
- **Validation is always the last wave**, after all build tasks complete.
- **Aim for wide waves**: 3 parallel tasks in 1 wave is better than 3 sequential waves of 1 task.

Quality guardrails:
- Two tasks in the same wave must NOT modify the same file.
- Two tasks in the same wave must NOT have a producer/consumer relationship.
- Each task must be self-contained — a builder should complete it without needing another builder's uncommitted work.

## Sizing Rules

- Max **5 tasks** per phase. Each completable by one builder.
- Each phase MUST fit in 1 phase execution without context compaction.
- Prefer more smaller phases over fewer large ones.

## Plan Format

Plans use XML tags for structure. The format below is the **complete specification**.

```xml
# Plan: <descriptive name>

<description>
<what we're building/changing>
</description>

<objective>
<measurable goal — what's true when this plan is complete>
</objective>

<classification>
Type: <type>
Complexity: <complexity>
Risk: <risk>
</classification>

<decisions>
<user choices from the clarification step — each as a one-line "Question → Answer" pair>
<include ALL user answers that affect implementation, even if they seem obvious>
</decisions>

<!-- if medium or complex: -->
<problem-statement>
<specific problem or opportunity>
</problem-statement>

<solution-approach>
<approach, alternatives considered, rationale>
</solution-approach>
<!-- end if -->

<relevant-files>
- `path/to/file` — why it's relevant

<new-files>
- `path/to/new/file` — what it is
</new-files>
</relevant-files>

<phase1 name="Name">
<goal>one sentence</goal>

<tasks>
#### 1. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- <specific action>
- <specific action>

#### 2. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- <specific action>

#### N. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify acceptance criteria
- Run validation commands
</tasks>

<execution>
**Wave 1** (parallel): <task-id-a>, <task-id-b>
**Wave 2** (after wave 1): <task-id-c>
**Wave 3** (validation): validate-phase-1
</execution>

<criteria>
- [ ] <measurable criterion>
</criteria>

<validation>
- `<command>` — <what it checks>
</validation>

<test-contract>
- <test expectation for this phase>
(optional — include when phase produces testable behavior)
</test-contract>

<handoff>
<what next phase needs to know>
(required for all phases except the last)
</handoff>
</phase1>

<phase2 name="Name">
<!-- same structure -->
</phase2>
```

### Rules

- Tags used at top-level: `<description>`, `<objective>`, `<classification>`, `<decisions>`, `<problem-statement>` (medium/complex), `<solution-approach>` (medium/complex), `<relevant-files>`, `<new-files>` (nested in relevant-files)
- Phase tags: `<phaseN name="...">` where N is sequential integer
- Inside phase: `<goal>`, `<tasks>`, `<execution>`, `<criteria>`, `<validation>`, `<test-contract>` (optional), `<handoff>` (except last phase)

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING ONLY.** Do not build, write code, or deploy builder agents.
- **The orchestrator NEVER reads source code files directly.** Use `Task` with `subagent_type=Explore` for all codebase exploration. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches).
- Always validate the plan before reporting.
- Create `.devorch/plans/` directory if needed.
