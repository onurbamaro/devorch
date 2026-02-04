---
description: Map an existing project and generate devorch context files
model: opus
---

Map the current project's codebase and generate `.devorch/PROJECT.md` and `.devorch/CONVENTIONS.md`. These files ensure all builders write code in the same style and understand the project structure.

## Workflow

### 1. Collect mechanical data

Run both scripts **in parallel** (single message, two Bash tool calls):

- `bun ~/.claude/devorch-scripts/map-project.ts` → tech stack, folder structure, dependencies, scripts, git history
- `bun ~/.claude/devorch-scripts/map-conventions.ts` → naming, exports, imports, style, test framework

If scripts fail (no Bun, etc.), do the equivalent analysis manually.

### 2. Explore patterns

The scripts detect surface-level style (naming, semicolons, quotes). Builders also need to understand deeper patterns to write consistent code. Launch parallel `Task` agents with `subagent_type=Explore` to investigate:

- **Error handling** — throw vs Result type, custom error classes, error propagation, global handlers
- **Architectural patterns** — how services/modules are structured, DI, middleware chains, state management
- **Active workarounds** — patterns builders must preserve and why (e.g., "json-bigint used because IDs exceed MAX_SAFE_INTEGER", "older modules throw, newer modules use Result type — follow Result type")

Launch these as 1-2 Explore agents (group related concerns). Skip what doesn't apply.

**Sampling rule:** When a section has many files (50+ components, 20+ routes), read 3-5 representative files to identify the pattern. Stop when the pattern is clear.

### 3. Write PROJECT.md and CONVENTIONS.md

Write both files **in parallel** (single message, two Write tool calls).

**PROJECT.md** — from script output:

```markdown
# Project: <name>

<one-paragraph description: what it does, who it's for>

## Tech Stack
- Runtime: ...
- Framework: ...
- Database: ...
- Auth: ...

## Structure
<folder tree with annotations explaining each area's responsibility>

## How to Run
- Dev: `<command>`
- Build: `<command>`
- Test: `<command>`

## Key Patterns
<architectural patterns, state management, data flow — from Explore findings>

## Active Workarounds
<workarounds builders must preserve, and why they exist>
(skip if none found)
```

**CONVENTIONS.md** — from script output + Explore findings:

```markdown
# Code Conventions

## Naming
<variables, functions, types, files, directories>

## Exports & Imports
<named vs default, import style, path conventions>

## Style
<semicolons, quotes, indentation, formatting tool>

## Error Handling
<how errors are created, propagated, caught — from Explore findings>

## Patterns
<component structure, hooks patterns, service patterns — from Explore findings>

## Testing
<framework, location, naming, coverage approach>

## Gotchas
<things a builder needs to know to avoid mistakes>
```

### 4. Auto-commit

Stage and commit the generated files:
- Stage only `.devorch/PROJECT.md` and `.devorch/CONVENTIONS.md`
- Format: `chore(devorch): map project and conventions`

### 5. Report

Show what was generated, key conventions found, and suggest next steps:
- `/devorch:make-plan "description"` for planned work
- `/devorch:quick "description"` for small fixes

## Rules

- Do not narrate actions. Execute directly without preamble.
- **The orchestrator NEVER reads source code files directly.** Use Explore agents for pattern investigation. The orchestrator only reads script output and Explore agent results.
- Keep both files concise. CONVENTIONS.md is a reference for builders — every line should answer "how should I write this?"
- If scripts fail, do full manual analysis via Explore agents and warn the user.
