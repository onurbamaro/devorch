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

Read `.devorch/CONVENTIONS.md`. If missing, stop and tell the user: "No conventions found. Run `/devorch:map-codebase` first to establish coding conventions — this ensures all builders write consistent code."

Check if `.devorch/PROJECT.md` exists and is recent (less than 1 day old based on git log). If so, read it directly. Otherwise, run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` to get fresh project data and write the output to `.devorch/PROJECT.md`. Use this data as inline context for planning. If the script fails (no Bun, etc.), gather equivalent data via an Explore agent.

If `.devorch/plans/current.md` exists, ask the user if they want to archive it.

### 2. Classify

Determine before exploring:

- **Type**: `feature` | `fix` | `refactor` | `migration` | `chore` | `enhancement`
- **Complexity**: `simple` (1-2 files) | `medium` (3-10 files, some design) | `complex` (10+ files, architecture/compatibility)
- **Risk**: `low` (additive) | `medium` (modifies behavior, shared code) | `high` (runtime/build/deps, compatibility, data)

### 3. Clarify with the user

Use `AskUserQuestion` to resolve ambiguity **before** exploring. This prevents wasted exploration and wrong plans. Each question must have 2-4 clickable options so the user can answer fast (they can always type a custom answer).

**Skip this step entirely** if the request is specific, self-contained, and has only one reasonable interpretation.

**What to ask about** (pick only what's unclear — max 6 questions across 1-2 AskUserQuestion calls):

- **Scope** — Does the user want just X, or also Y? Should it handle edge case Z?
- **Approach** — When multiple architectures or patterns are viable, which does the user prefer?
- **Constraints** — Backward compatibility? Performance targets? Specific libraries to use or avoid?
- **Behavior** — What should happen on error? What's the UX for edge cases?
- **Priority** — Speed vs completeness? MVP vs full implementation?
- **Integration** — Should this connect to existing feature X? Replace or extend current behavior?

**Guidelines:**
- Use short, concrete options — not vague ones like "Option A" / "Option B". Each option should describe a real choice (e.g., "JWT with refresh tokens", "Session-based with Redis").
- Front-load the recommended option and append "(Recommended)" to its label.
- Don't ask what you can answer from the codebase — save those for the Explore step.
- Don't ask obvious questions that the conventions or project data already answer.

### 4. Explore proportionally (informed by user answers)

Use `Task` agents with `subagent_type=Explore` for all codebase exploration. **Do NOT read source files directly** — use Explore agent summaries as your evidence base.

**Simple + Low risk** — One Explore agent to skim the affected area.

**Medium** — Launch parallel Explore agents: one per affected area (e.g., "what files import from X and how?", "how is the API layer structured?"). Use Grep directly only for quantification (counting imports, usage patterns).

**Complex OR High risk** — Launch parallel Explore agents covering every affected area. Use Grep for quantification. Ask Explore agents to check dependency compatibility, identify hidden risks (dynamic requires, native addons, platform-specific code).

**Evidence-based planning**: every task must reference real files discovered by Explore agents, not assumptions. Quantify: "Update 14 files that import from X", not "Update files".

**Cache exploration results**: After all Explore agents return, write `.devorch/explore-cache.md` with the summaries:

```markdown
# Explore Cache
Generated: <ISO timestamp>

## <area-name-1>
<Explore agent summary for this area>

## <area-name-2>
<Explore agent summary for this area>
```

This cache is reused by `/devorch:build` to avoid re-exploring the same areas. Each section title should match the area explored (e.g., "Auth module", "API routes", "Database layer").

### 5. Design solution (medium/complex only)

Think through: core problem, approach, alternatives considered, risks and mitigations.

### 6. Create plan

Write `.devorch/plans/current.md` following the **Plan Format** below.

### 7. Validate

Run `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan .devorch/plans/current.md`. Fix issues if blocked. On success, the output includes a `hash` field — append `<!-- Validated: <hash> -->` as the last line of the plan file.

### 8. Reset state

Delete `.devorch/state.md` and `.devorch/state-history.md` if they exist — a new plan means fresh state. Previous plan's progress is irrelevant.

### 9. Auto-commit

Stage and commit all devorch files modified in this session:
- Stage `.devorch/plans/current.md`, `.devorch/explore-cache.md` (if created), `.devorch/PROJECT.md` (if created/updated)
- If state.md or state-history.md were deleted, stage those deletions too
- Format: `chore(devorch): plan — <descriptive plan name>`

### 10. Report

Show classification, phases with goals, wave structure, then instruct: `/devorch:build 1` or `/devorch:build-all`. Mention that `/devorch:check-implementation` runs automatically at the end of build-all, or can be run manually after individual builds.

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
- Each phase MUST fit in 1 `/devorch:build` execution without context compaction.
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
(skip section if no clarification was needed)
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

- Tags used at top-level: `<description>`, `<objective>`, `<classification>`, `<decisions>` (optional), `<problem-statement>` (medium/complex), `<solution-approach>` (medium/complex), `<relevant-files>`, `<new-files>` (nested in relevant-files)
- Phase tags: `<phaseN name="...">` where N is sequential integer
- Inside phase: `<goal>`, `<tasks>`, `<execution>`, `<criteria>`, `<validation>`, `<test-contract>` (optional), `<handoff>` (except last phase)

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING ONLY.** Do not build, write code, or deploy builder agents.
- **The orchestrator NEVER reads source code files directly.** Use `Task` with `subagent_type=Explore` for all codebase exploration. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches).
- Always validate the plan before reporting.
- Create `.devorch/plans/` directory if needed.
