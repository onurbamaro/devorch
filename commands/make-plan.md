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

Read `.devorch/PROJECT.md` and `.devorch/CONVENTIONS.md`. If either is missing, stop and tell the user: "No project context found. Run `/devorch:map-codebase` first to map the project and establish coding conventions — this ensures all builders write consistent code."

If `.devorch/plans/current.md` exists, ask the user if they want to archive it.

### 2. Classify

Determine before exploring:

- **Type**: `feature` | `fix` | `refactor` | `migration` | `chore` | `enhancement`
- **Complexity**: `simple` (1-2 files) | `medium` (3-10 files, some design) | `complex` (10+ files, architecture/compatibility)
- **Risk**: `low` (additive) | `medium` (modifies behavior, shared code) | `high` (runtime/build/deps, compatibility, data)

### 3. Explore proportionally

Use `Task` agents with `subagent_type=Explore` for all codebase exploration. **Do NOT read source files directly** — use Explore agent summaries as your evidence base.

**Simple + Low risk** — One Explore agent to skim the affected area.

**Medium** — Launch parallel Explore agents: one per affected area (e.g., "what files import from X and how?", "how is the API layer structured?"). Use Grep directly only for quantification (counting imports, usage patterns).

**Complex OR High risk** — Launch parallel Explore agents covering every affected area. Use Grep for quantification. Ask Explore agents to check dependency compatibility, identify hidden risks (dynamic requires, native addons, platform-specific code).

**Evidence-based planning**: every task must reference real files discovered by Explore agents, not assumptions. Quantify: "Update 14 files that import from X", not "Update files".

### 4. Design solution (medium/complex only)

Think through: core problem, approach, alternatives considered, risks and mitigations.

### 5. Create plan

Write `.devorch/plans/current.md` following the **Plan Format** below.

### 6. Validate

Run `bun ~/.claude/devorch-scripts/validate-plan.ts --plan .devorch/plans/current.md`. Fix issues if blocked.

### 7. Auto-commit

Stage and commit the plan file:
- Stage only `.devorch/plans/current.md` (and `.devorch/plans/` directory creation)
- Format: `chore(devorch): plan — <descriptive plan name>`

### 8. Report

Show classification, phases with goals, team, wave structure, then instruct: `/devorch:build 1`.

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

```markdown
# Plan: <descriptive name>

## Task Description
<what we're building/changing>

## Objective
<measurable goal — what's true when this plan is complete>

## Classification
- Type: <type>
- Complexity: <complexity>
- Risk: <risk>

<if medium or complex:>
## Problem Statement
<specific problem or opportunity>

## Solution Approach
<approach, alternatives considered, rationale>
</if>

## Relevant Files
<files that will be touched, with bullet explaining why>

### New Files
<files to be created, if any>

## Team Members

- **<builder-name>**
  - Role: <specific focus>
  - Agent: devorch-builder

<more builders as needed>

- **validator**
  - Role: Final validation of each phase
  - Agent: devorch-validator

## Phase 1 — <Name>

### Goal
<one sentence>

### Tasks

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

### Execution
- **Wave 1** (parallel): <task-id-a>, <task-id-b>
- **Wave 2** (after wave 1): <task-id-c>
- **Wave 3** (validation): validate-phase-1

### Acceptance Criteria
- [ ] <measurable criterion>

### Validation Commands
- `<command>` — <what it checks>

### Handoff
<what next phase needs to know>

## Phase 2 — <Name>
<same structure>
```

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING ONLY.** Do not build, write code, or deploy builder agents.
- **The orchestrator NEVER reads source code files directly.** Use `Task` with `subagent_type=Explore` for all codebase exploration. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches).
- Always validate the plan before reporting.
- Create `.devorch/plans/` directory if needed.
