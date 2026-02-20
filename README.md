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

**Automatic validation** -- Every phase runs lint, typecheck, and validation commands in parallel. The final build step adds adversarial review with specialized agents (security, quality, completeness). Bugs surface immediately.

**State-aware resumption** -- Interrupted? Run `/devorch:build` again and pick up exactly where you left off. Phase handoffs carry just enough context for continuity without bloating the window.

---

## Quick Start

### Install

```bash
bun run install.ts
```

### Your first build in 30 seconds

```bash
# Explore, plan, and build a feature
/devorch:talk "add user authentication with JWT"
```

That's it. devorch explores your codebase with parallel Agent Teams, clarifies ambiguities with you, creates a phased plan with parallel waves, sets up a git worktree, and hands off to `/devorch:build`. Coding conventions are detected automatically on first run.

---

## What You Can Do

### Start a new project from scratch

```
/devorch:talk "..."   # detects empty project, runs discovery Q&A, plans first milestone
```

### Add features to an existing project

```
/devorch:talk "..."   # auto-generates CONVENTIONS.md on first run, plans and builds
```

### Ship a quick fix

```
/devorch:fix "fix the login redirect bug"
```

devorch classifies the task intelligently -- if it needs design decisions or has structural impact, it redirects to `/devorch:talk`. Otherwise it investigates with parallel agents, implements the fix directly, validates, and commits.

### Explore an idea

```
/devorch:talk "how does the auth module work? is it safe to refactor?"
```

Conversation mode: devorch explores the codebase with Agent Teams and presents findings. If you decide to act, it generates a plan.

---

## How It Works

devorch has three commands, each focused on a specific workflow:

1. **`/devorch:talk`** -- Conversation, exploration, and planning. Launches parallel Explore agents with specialized roles (architecture, risk, patterns), clarifies ambiguities with you, then produces a structured plan in a git worktree.

2. **`/devorch:fix`** -- Targeted fixes. Classifies the task (fix vs needs planning), investigates with parallel agents testing distinct hypotheses, implements directly, validates in parallel, and auto-fixes trivial issues.

3. **`/devorch:build`** -- Phased execution. Deploys builder agents in parallel waves per phase, runs automated checks after each phase, then performs a final adversarial review with security, quality, and completeness reviewers. Auto-fixes trivial findings; generates `/devorch:fix` prompts for complex ones.

### Agents

| Agent | Role | Model | Mode |
|-------|------|-------|------|
| `devorch-builder` | Implements one task. Writes code, validates, commits. | opus | read-write |

Builders get a post-edit lint hook that catches errors immediately after every write, not at commit time.

### Scripts

| Script | Purpose |
|--------|---------|
| `init-phase.ts` | Loads phase context: objective, decisions, conventions, explore cache. Returns JSON. |
| `check-project.ts` | Runs lint + typecheck in parallel, then build, then test. Returns JSON. |
| `run-validation.ts` | Runs validation commands for a phase. Returns pass/fail per command. |
| `format-commit.ts` | Generates conventional commit messages from phase content. |
| `update-state.ts` | Writes state.md with phase summary. |
| `map-project.ts` | Collects tech stack, folder structure, dependencies, scripts, git history. |
| `map-conventions.ts` | Analyzes code patterns to generate CONVENTIONS.md. |
| `validate-plan.ts` | Validates plan structure (sections, phase numbering, task metadata, wave consistency). |
| `manage-cache.ts` | Invalidates and trims explore-cache.md. |
| `setup-worktree.ts` | Creates a git worktree for isolated plan execution. |
| `list-worktrees.ts` | Lists active devorch worktrees with status. |
| `archive-plan.ts` | Archives completed plans. |

Scripts import shared utilities from `scripts/lib/` (plan-parser, args, fs-utils).

### Key Concepts

- **Phases** -- Sequential milestones. Phase N+1 receives a handoff summary from phase N.
- **Waves** -- Groups of tasks within a phase that run in parallel. Tasks in the same wave never modify the same file.
- **Tasks** -- Atomic units of work assigned to individual builder agents.
- **Explore cache** -- Summaries from Explore agents, reused across phases to avoid redundant exploration.
- **State tracking** -- `state.md` tracks the last completed phase and handoff summary.
- **Worktrees** -- Each plan executes in an isolated git worktree. Merged back on success.

---

## Commands Reference

| Command | What it does | Uses agents |
|---------|-------------|-------------|
| `/devorch:talk` | Conversation, exploration, and planning. Creates phased plans in worktrees. | Explore (Agent Teams) |
| `/devorch:fix` | Targeted fix with investigation. Classifies, investigates, implements, validates. | Explore |
| `/devorch:build` | Executes all remaining phases + adversarial final verification. | Explore, Builder |
| `/devorch:worktrees` | List, merge, or delete devorch worktrees. | -- |

---

## Project Structure

```
devorch/
  commands/          # slash command definitions (.md)
  agents/            # agent type definitions (.md)
  scripts/           # TypeScript utilities (Bun)
    lib/             # shared modules (plan-parser, args, fs-utils)
  templates/         # build-phase template
  hooks/             # post-edit lint + statusline
  install.ts         # installer
  uninstall.ts       # uninstaller
```

Installed to `~/.claude/` (commands, agents, scripts, templates, hooks). Per-project state lives in `.devorch/`.

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
  version: 2.0.0
  description: Multi-agent orchestration framework for Claude Code
  license: MIT
  runtime: Bun
  language: TypeScript

capabilities:
  - Phased plan creation from natural language descriptions
  - Parallel builder agent deployment in waves
  - Automatic phase validation (lint, typecheck, build, tests)
  - Adversarial final verification (security, quality, completeness reviewers)
  - State tracking with cross-session resumption
  - Codebase exploration via parallel Agent Teams
  - Convention-aware code generation
  - Git worktree isolation per plan

commands:
  - name: talk
    signature: /devorch:talk "<description>"
    purpose: Conversation, exploration, and planning with Agent Teams
  - name: fix
    signature: /devorch:fix "<description>"
    purpose: Targeted fix with investigation, direct execution, and verification
  - name: build
    signature: /devorch:build [--plan <name>]
    purpose: Execute all remaining phases then verify with adversarial review
  - name: worktrees
    signature: /devorch:worktrees
    purpose: List, merge, or delete devorch worktrees

architecture:
  agents:
    - name: devorch-builder
      role: Implements one task, writes code, validates, commits
      model: opus
      mode: read-write
  scripts:
    - init-phase.ts (phase context loading)
    - check-project.ts (lint + typecheck + build + test)
    - run-validation.ts (validation command execution)
    - format-commit.ts (commit message generation)
    - update-state.ts (state tracking)
    - map-project.ts (tech stack and structure collection)
    - map-conventions.ts (code pattern analysis)
    - validate-plan.ts (plan structure validation)
    - manage-cache.ts (explore cache management)
    - setup-worktree.ts (worktree creation)
    - list-worktrees.ts (worktree listing)
    - archive-plan.ts (plan archival)
  shared_lib:
    - scripts/lib/plan-parser.ts (plan file parsing utilities)
    - scripts/lib/args.ts (CLI argument parsing)
    - scripts/lib/fs-utils.ts (file system utilities)

key_concepts:
  - phase: Sequential milestone, max 5 tasks, handoff summary to next phase
  - wave: Parallel task group within a phase, no shared file modifications
  - task: Atomic work unit assigned to one builder agent
  - explore_cache: Reusable Explore agent summaries (.devorch/explore-cache.md)
  - state: Last completed phase tracked in .devorch/state.md
  - worktree: Isolated git worktree per plan, merged on success

state_files:
  - path: .devorch/ARCHITECTURE.md
    purpose: Architecture design (generated by /devorch:talk for new projects)
  - path: .devorch/CONVENTIONS.md
    purpose: Coding conventions, auto-generated on first run
  - path: .devorch/explore-cache.md
    purpose: Cached Explore agent summaries
  - path: .devorch/plans/current.md
    purpose: Active plan
  - path: .devorch/plans/archive/
    purpose: Completed plans (auto-archived)
  - path: .devorch/state.md
    purpose: Last completed phase and handoff summary

file_structure:
  source:
    - commands/ (4 .md slash command definitions)
    - agents/ (1 .md agent type definition)
    - scripts/ (12 .ts utility scripts + lib/)
    - templates/ (1 .md build-phase template)
    - hooks/ (post-edit lint + statusline)
    - install.ts (installer)
    - uninstall.ts (uninstaller)
  installed:
    - ~/.claude/commands/devorch/ (commands)
    - ~/.claude/agents/ (agent definitions)
    - ~/.claude/devorch-scripts/ (utility scripts)
    - ~/.claude/devorch-templates/ (templates)
    - ~/.claude/hooks/ (hooks)
```
