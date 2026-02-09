---
description: Plan a testing strategy for the project
argument-hint: [optional scope — e.g., "auth module" or "API layer"]
model: opus
disallowed-tools: EnterPlanMode
---

Plan a testing strategy for the project.

**Input**: $ARGUMENTS (optional scope to focus on). If empty, plan tests for the entire project.

## Steps

### 1. Load context

**Project data**: Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` to collect tech stack, folder structure, dependencies, and scripts. Use this output as inline context for planning — do not save it to a file. If the script fails (no Bun, etc.), gather equivalent data via an Explore agent.

**Conventions**: Read `.devorch/CONVENTIONS.md`.

- **If missing**: Generate it now. Launch 1-2 Explore agents (use the **Task tool call** with `subagent_type="Explore"`) to investigate:
  - **Architectural patterns** — how services/modules are structured, error handling patterns
  - **Active workarounds** — patterns builders must preserve and why
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

- **If exists**: Quick staleness check — compare library names mentioned in CONVENTIONS.md against current `package.json` dependencies. If stale, regenerate.

### 2. Assess project

Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` to understand current project health and existing test infrastructure.

### 3. Classify scope

Determine before exploring:

- **Scope**: `focused` (1-2 modules, from $ARGUMENTS) | `broad` (full project)
- **Size**: `small` (< 10 source files) | `medium` (10-50 files) | `large` (50+ files)

### 4. Initial exploration

Before asking the user anything, understand the codebase. Launch Explore agents to map the testable areas — structure, patterns, complexity, existing test coverage.

Use the **Task tool call** with `subagent_type="Explore"`. Scale to size:

- **Small** — One Explore agent for the whole codebase.
- **Medium** — Parallel Explore agents: one per area (e.g., "business logic", "API routes", "UI components", "utilities").
- **Large** — Parallel Explore agents covering every significant area.

### 5. Clarify with the user (never skip)

Use `AskUserQuestion` to eliminate **every** ambiguity before planning. Each question must have 2-4 clickable options (the user can always type a custom answer).

**This step is mandatory.** Even if the request seems clear, the initial exploration will reveal decisions that need user input — framework preferences, scope boundaries, mocking strategies.

**What to ask about** (cover ALL that apply — no artificial limit on number of questions):

- **Scope** — Which modules to prioritize? Any areas to exclude?
- **Framework** — If no test framework exists, which to use? (suggest based on stack)
- **Strategy** — Unit-heavy? Integration-focused? E2E for critical flows?
- **Priority** — Test everything, or focus on critical paths first?
- **Mocking** — How to handle external dependencies? (mock, stub, test containers?)
- **Coverage** — Target percentage? Or just critical paths?

**Ask in rounds.** Use up to 4 questions per `AskUserQuestion` call (tool limit). If more questions remain, make another call after the user answers. Continue until all ambiguity is resolved — there is no cap on rounds. The goal is **zero assumptions** in the plan.

**Guidelines:**
- Use short, concrete options — not vague ones like "Option A" / "Option B". Each option should describe a real choice (e.g., "Vitest with happy-dom", "Jest with jsdom").
- Front-load the recommended option and append "(Recommended)" to its label.
- Ground questions in what the exploration found — reference real files, patterns, or test gaps discovered.
- Don't ask what CONVENTIONS.md already answers.
- Don't ask the user to make decisions you're better equipped to make (pure implementation details).

### 6. Deep exploration (informed by user answers)

If user answers revealed new areas to explore, launch additional Explore agents targeted by user's choices.

Use the **Task tool call** with `subagent_type="Explore"` for all codebase exploration. **Do NOT read source files directly** — use Explore agent summaries as your evidence base. Use Grep directly only for quantification (counting matches).

**Cache exploration results**: After all Explore agents return (from both step 4 and step 6), write `.devorch/explore-cache.md` with the combined summaries (or append to existing cache):

```markdown
# Explore Cache
Generated: <ISO timestamp>

## <area-name-1>
<Explore agent summary for this area>

## <area-name-2>
<Explore agent summary for this area>
```

This cache is reused by `/devorch:build-tests` to avoid re-exploring the same areas.

### 7. Create test plan

Write `.devorch/plans/tests.md` using this format:

```xml
# Test Plan

<description>
<what we're testing and why>
</description>

<objective>
<measurable goal — what's true when this plan is complete>
</objective>

<decisions>
<user choices from clarification — each as a one-line "Question → Answer" pair>
<include ALL user answers that affect test generation, even if they seem obvious>
</decisions>

<strategy>
- Unit tests: [framework, location, naming convention]
- Integration tests: [approach, setup]
- E2E tests: [framework if needed, key flows]
</strategy>

<setup>
- [Framework to install (if needed)]
- [Config files to create (if needed)]
- [Any other infrastructure]
(skip section if no setup needed)
</setup>

<module name="Module Name">
<files>
- `path/to/source.ts` — what it does
</files>
<unit-tests>
- [ ] Test description — what behavior it verifies
</unit-tests>
<integration-tests>
- [ ] Test description
</integration-tests>
</module>

<module name="Another Module">
...
</module>

<fixtures>
- [What needs mocking and approach]
</fixtures>
```

### 8. Auto-commit

Stage and commit all devorch files modified in this session:
- Stage `.devorch/plans/tests.md`, `.devorch/explore-cache.md` (if created/updated), `.devorch/CONVENTIONS.md` (if created/updated)
- Format: `chore(devorch): plan tests`

### 9. Report

Show scope, modules with test counts, setup needs, then instruct:

```
/clear
/devorch:build-tests
```

Explain: planning consumes significant context — `/clear` frees it before build starts. The plan is saved to disk, so nothing is lost.

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING ONLY.** Do not write test code.
- **The orchestrator NEVER reads source code files directly.** Use the **Task tool call** with `subagent_type="Explore"` for all code analysis. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches).
- Organize by module/feature, NOT by build phase.
- Prioritize: business logic > API endpoints > UI interactions > utilities.
- Don't over-test. Focus on behavior, not implementation details.
- Consider the existing test framework (from CONVENTIONS.md) — don't introduce new ones unless user explicitly agrees.
- Create `.devorch/plans/` directory if needed.
