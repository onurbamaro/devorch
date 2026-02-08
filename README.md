[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1.svg)](https://bun.sh)
[![Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-6B4FBB.svg)](https://claude.ai/claude-code)

# devorch

**Ship features 10x faster with multi-agent orchestration for Claude Code.**

Stop feeding Claude Code one prompt at a time. devorch breaks your work into phased plans, deploys parallel builder agents, validates every phase automatically, and tracks state across sessions. You describe what you want built. devorch coordinates the agents that build it.

---

## Why devorch

**Zero context switching** -- Describe a feature once. devorch plans it, explores the codebase, builds it across parallel agents, and verifies the result. You stay in flow.

**Parallel execution** -- Builder agents run simultaneously in waves. A 5-task phase finishes in the time it takes to run the slowest task, not all five sequentially.

**Automatic validation** -- Every phase ends with a validator agent that checks acceptance criteria, runs lint, typecheck, build, and tests. Bugs surface immediately, not three phases later.

**State-aware resumption** -- Interrupted? Run `/devorch:build` again and pick up exactly where you left off. Phase handoffs carry just enough context for continuity without bloating the window.

---

## Quick Start

### Install

```bash
bun run install.ts
```

### Your first build in 30 seconds

```bash
# 1. Plan the work
/devorch:make-plan "add user authentication with JWT"

# 2. Clear context and build
/clear
/devorch:build
```

That's it. devorch explores your codebase, creates a phased plan with parallel waves, deploys builder agents, validates each phase, and commits the results. Coding conventions are detected automatically on the first plan.

---

## What You Can Do

### Start a new project from scratch

```
/devorch:make-plan "..."   # detects empty project, runs discovery Q&A, plans first milestone
/clear                      # free context before building
/devorch:build              # execute all phases + verify
```

### Add features to an existing project

```
/devorch:make-plan "..."   # plan the work (auto-generates CONVENTIONS.md on first run)
/clear                      # free context before building
/devorch:build              # execute all phases + verify
```

### Ship a quick fix

```
/devorch:quick "fix the login redirect bug"
```

Direct implementation with auto-commit. Automatically escalates to a full plan if the change is too complex.

### Plan and generate tests

```
/devorch:plan-tests        # analyze code -- .devorch/plans/tests.md
/devorch:make-tests        # generate and run tests from the plan
```

---

## How It Works

devorch follows a **plan -- execute -- verify** cycle:

1. **Plan** -- `/make-plan` classifies work by type, complexity, and risk. It explores the codebase with parallel Explore agents, then produces a structured plan with phases, waves, and tasks.

2. **Execute** -- `/build` deploys builder agents in parallel waves. Each builder gets only the context it needs: task details, relevant conventions, and filtered Explore summaries.

3. **Verify** -- A validator agent checks acceptance criteria and runs automated checks (lint, typecheck, build, tests). Failed builders get one automatic retry with diagnostic context.

### Agents

| Agent | Role | Model | Mode |
|-------|------|-------|------|
| `devorch-builder` | Implements one task. Writes code, validates, commits. | opus | read-write |
| `devorch-validator` | Verifies phase completion against acceptance criteria. | opus | read-only |

Builders get a post-edit lint hook that catches errors immediately after every write, not at commit time.

### Scripts

| Script | Purpose |
|--------|---------|
| `check-project.ts` | Runs lint + typecheck in parallel, then build, then test. Returns JSON. |
| `extract-phase.ts` | Extracts a single phase from a plan file (saves ~30-40% tokens). |
| `extract-criteria.ts` | Extracts all acceptance criteria and validation commands as structured JSON. |
| `hash-plan.ts` | SHA-256 hash of plan content. Detects modifications since validation. |
| `map-project.ts` | Collects tech stack, folder structure, dependencies, scripts, git history. |
| `map-conventions.ts` | Analyzes naming, exports, style, testing patterns from code samples. |
| `validate-plan.ts` | Validates plan structure (sections, phase numbering, task metadata, wave consistency). |
| `check-agent-teams.ts` | Validates Agent Teams feature flag and parses team templates. |

### Key Concepts

- **Phases** -- Sequential milestones. Phase N+1 receives a handoff summary from phase N.
- **Waves** -- Groups of tasks within a phase that run in parallel. Tasks in the same wave never modify the same file.
- **Tasks** -- Atomic units of work assigned to individual builder agents.
- **Explore cache** -- Summaries from Explore agents, reused across phases to avoid redundant exploration.
- **State tracking** -- `state.md` tracks the last completed phase. Previous summaries live in `state-history.md`.

---

## Commands Reference

| Command | What it does | Uses agents |
|---------|-------------|-------------|
| `/devorch:make-plan` | Creates phased plan. Auto-detects new projects (discovery Q&A + ARCHITECTURE.md). Auto-generates CONVENTIONS.md. | Explore |
| `/devorch:build` | Executes all remaining phases + runs check-implementation. | Explore, Builder, Validator |
| `/devorch:check-implementation` | Verifies full implementation against all criteria. | Explore |
| `/devorch:quick` | Small fix with auto-commit. Escalates to make-plan if complex. | Explore |
| `/devorch:plan-tests` | Plans testing strategy per module. | Explore |
| `/devorch:make-tests` | Generates and runs tests from the test plan. | Explore, Builder |
| `/devorch:debug` | Agent Teams hypothesis-testing investigation. | Agent Teams |
| `/devorch:review` | Agent Teams adversarial code review. | Agent Teams |
| `/devorch:explore-deep` | Agent Teams deep architectural exploration. | Agent Teams |

---

## Advanced: Multi-Agent Teams (experimental)

Push orchestration further with Claude Code's experimental Agent Teams feature. Spawn specialized teams for debugging, code review, and deep exploration.

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

| Command | What it does |
|---------|-------------|
| `/devorch:debug` | Spawns a lead + 4 investigators for concurrent hypothesis testing. |
| `/devorch:review` | Adversarial code review with 4 reviewers (security, quality, performance, tests). |
| `/devorch:explore-deep` | Deep architectural exploration with multi-perspective debate. |

Optional flags on existing commands:

- `/devorch:make-plan --team` -- Spawns a 2-analyst planning team. Auto-escalates for complex tasks.
- `/devorch:check-implementation --team` -- Adds adversarial review layer (security + quality + performance).

Team structure is configured per project in `.devorch/team-templates.md`, generated on first use with sensible defaults.

---

## Project Structure

```
devorch/
  commands/          # slash command definitions (.md)
  agents/            # agent type definitions (.md)
  scripts/           # TypeScript utilities (Bun)
  hooks/             # post-edit lint + statusline
  install.ts         # installer
  uninstall.ts       # uninstaller
```

Installed to `~/.claude/` (commands, agents, scripts, hooks). Per-project state lives in `.devorch/`.

---

## Requirements

- [Bun](https://bun.sh) runtime -- required to execute the TypeScript utility scripts (plan extraction, validation, linting). Install with `curl -fsSL https://bun.sh/install | bash`.
- [Claude Code](https://claude.ai/claude-code) CLI

---

<!-- LLM-FRIENDLY PROJECT SUMMARY -->
## For AI Agents

```yaml
project:
  name: devorch
  version: 1.0.0
  description: Multi-agent orchestration framework for Claude Code
  license: MIT
  runtime: Bun
  language: TypeScript

capabilities:
  - Phased plan creation from natural language descriptions
  - Parallel builder agent deployment in waves
  - Automatic phase validation (lint, typecheck, build, tests)
  - State tracking with cross-session resumption
  - Codebase exploration via Explore agents with caching
  - Convention-aware code generation
  - Agent Teams for debugging, review, and deep exploration

commands:
  - name: make-plan
    signature: /devorch:make-plan "<description>"
    purpose: Create phased plan. Discovers new projects, auto-generates CONVENTIONS.md
    flags: [--team]
  - name: build
    signature: /devorch:build
    purpose: Execute all remaining phases then verify
  - name: check-implementation
    signature: /devorch:check-implementation
    purpose: Verify full implementation against all acceptance criteria
    flags: [--team]
  - name: quick
    signature: /devorch:quick "<description>"
    purpose: Small fix with auto-commit, escalates if complex
  - name: plan-tests
    signature: /devorch:plan-tests
    purpose: Plan testing strategy per module
  - name: make-tests
    signature: /devorch:make-tests
    purpose: Generate and run tests from test plan
  - name: debug
    signature: /devorch:debug
    purpose: Agent Teams concurrent hypothesis-testing investigation
  - name: review
    signature: /devorch:review
    purpose: Agent Teams adversarial code review
  - name: explore-deep
    signature: /devorch:explore-deep
    purpose: Agent Teams deep architectural exploration

architecture:
  agents:
    - name: devorch-builder
      role: Implements one task, writes code, validates, commits
      model: opus
      mode: read-write
    - name: devorch-validator
      role: Verifies phase completion against acceptance criteria
      model: opus
      mode: read-only
  scripts:
    - check-project.ts (lint + typecheck + build + test)
    - extract-phase.ts (phase extraction from plan)
    - extract-criteria.ts (criteria extraction as JSON)
    - hash-plan.ts (plan integrity via SHA-256)
    - map-project.ts (tech stack and structure collection)
    - map-conventions.ts (code pattern analysis)
    - validate-plan.ts (plan structure validation)
    - check-agent-teams.ts (Agent Teams feature flag validation)

key_concepts:
  - phase: Sequential milestone, max 5 tasks, handoff summary to next phase
  - wave: Parallel task group within a phase, no shared file modifications
  - task: Atomic work unit assigned to one builder agent
  - explore_cache: Reusable Explore agent summaries (.devorch/explore-cache.md)
  - state: Last completed phase tracked in .devorch/state.md
  - state_history: Previous phase summaries in .devorch/state-history.md

state_files:
  - path: .devorch/ARCHITECTURE.md
    purpose: Architecture design (generated by /make-plan for new projects)
  - path: .devorch/CONVENTIONS.md
    purpose: Coding conventions, auto-generated by /make-plan
  - path: .devorch/explore-cache.md
    purpose: Cached Explore agent summaries
  - path: .devorch/plans/current.md
    purpose: Active plan
  - path: .devorch/plans/tests.md
    purpose: Test plan
  - path: .devorch/plans/archive/
    purpose: Completed plans (auto-archived)
  - path: .devorch/state.md
    purpose: Last completed phase and handoff summary
  - path: .devorch/state-history.md
    purpose: Previous phase summaries (append-only)

file_structure:
  source:
    - commands/ (9 .md slash command definitions)
    - agents/ (2 .md agent type definitions)
    - scripts/ (8 .ts utility scripts)
    - hooks/ (post-edit lint + statusline)
    - install.ts (installer)
    - uninstall.ts (uninstaller)
  installed:
    - ~/.claude/commands/devorch/ (commands)
    - ~/.claude/agents/ (agent definitions)
    - ~/.claude/devorch-scripts/ (utility scripts)
    - ~/.claude/hooks/ (hooks)
```
