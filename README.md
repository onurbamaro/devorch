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

**Automatic validation** -- Every phase runs a quick build + typecheck check (10s). The final build step runs the complete suite (lint, typecheck, build, tests) plus adversarial review with specialized agents (security, quality, completeness). Bugs surface immediately.

**State-aware resumption** -- Interrupted? Run `/devorch --resume` and pick up exactly where you left off. Phase handoffs carry just enough context for continuity without bloating the window.

---

## One command, right-sized ceremony

The primary entry point is a single command: **`/devorch`**. It classifies the request (quick / scoped / full), applies an inline senior-guardian pass against industry standards, and executes at the ceremony level the scope actually deserves. Trivial edits skip planning entirely; multi-module features still get full phased execution with waves.

```
/devorch "fix the login redirect bug"              # triaged to quick — direct edit
/devorch "add POST /orders/bulk endpoint"           # triaged to scoped — single gate, targeted explore
/devorch "add real-time order dashboard"            # triaged to full — worktree, phases, waves
/devorch --full "<...>"                             # override classification
/devorch --resume                                   # resume an active worktree
```

The guardian is active in every mode. Security (OWASP), performance, architecture, and operations patterns are checked inline — heads-up redirects surface when there's a known-right answer, bifurcations only surface when the trade-off is legitimate. Personal priorities live in `.devorch/profile.yml`.

**Key properties:**
- Triage is LLM-inline, not a script — intent classification is judgment
- Ceremony is proportional to scope — `quick` skips planning, `full` runs the full pipeline
- Guardian posture is default-on, silent when code is correct
- Edge cases are enumerated up front; questions fire only on real bifurcations
- Single gate UX: `[Nenhum / Todos / Números]` instead of question chains
- Profile-driven priorities (performance, security, cost, dx) weight bifurcations

Philosophy, profile format, and flag handling are documented in `docs/PHILOSOPHY.md`, `docs/PROFILE.md`, and `docs/FLAGS.md`.

---

## Quick Start

### Install

```bash
bun run install.ts
```

### Your first build in 30 seconds

```bash
# Explore, plan, and build a feature
/devorch "add user authentication with JWT"
```

That's it. devorch triages the request, explores your codebase with parallel Explore agents, clarifies ambiguities with you, creates a phased plan with parallel waves, sets up a git worktree, and executes phases through builder agents. Coding conventions are detected automatically on first run.

---

## What You Can Do

### Start a new project from scratch

```
/devorch "..."   # detects empty project, runs discovery Q&A, plans first milestone
```

### Add features to an existing project

```
/devorch "..."   # auto-generates CONVENTIONS.md on first run, plans and builds
```

### Work across multiple repos

```
/devorch "add real-time sync between salsago-core and salsago-web"
```

devorch detects sibling repositories automatically. During planning, it asks which repos to include as satellites. Each repo gets its own worktree with the same branch name. Validation runs per-repo, and merge is coordinated across all of them.

### Ship a quick fix

```
/devorch "fix the login redirect bug"
```

Triage classifies the task intelligently — small, localized fixes run in `quick` mode (direct edit, guardian sweep, commit). Anything with design impact escalates to `scoped` or `full` automatically.

### Explore an idea

```
/devorch "how does the auth module work? is it safe to refactor?"
```

Exploration requests stay conversational: devorch runs Explore agents and presents findings without building anything. If you decide to act on the findings, re-invoke with an action request.

---

## How It Works

`/devorch` is a single unified entry with three internal modes, selected automatically by triage (or forced via `--quick` / `--full`):

1. **`quick`** -- Direct edit. No plan, no worktree. The orchestrator classifies, runs a guardian sweep, edits, lets the post-edit lint hook fire, and commits. For typos, renames, and isolated small fixes.

2. **`scoped`** -- Targeted change with a single explore pass. One Explore agent investigates, edge cases are enumerated, a single gate surfaces any real bifurcations, then the orchestrator executes directly and validates. For 1–3 file changes with a clear shape.

3. **`full`** -- Phased execution. Creates a worktree, runs parallel Explore agents with distinct foci, produces a phased plan with parallel waves, deploys builder agents per wave, validates after each phase (quick check: build + typecheck), and performs a final adversarial review with security, quality, and completeness reviewers. Auto-fixes trivial findings; surfaces complex ones as flags.

### Agents

| Agent | Role | Model | Mode |
|-------|------|-------|------|
| `devorch-builder` | Implements one task. Writes code, validates, commits. | opus | read-write |

Builders get a post-edit lint hook that catches errors immediately after every write, not at commit time.

### Scripts

| Script | Purpose |
|--------|---------|
| `init-phase.ts` | Loads phase context: objective, decisions, conventions, explore cache. Returns JSON. |
| `check-project.ts` | Runs lint + typecheck + build + test in parallel. With `--quick`, runs only build + typecheck (10s). Returns JSON. |
| `map-project.ts` | Collects tech stack, folder structure, dependencies, scripts, git history. |
| `map-conventions.ts` | Analyzes code patterns to generate CONVENTIONS.md. |
| `validate-plan.ts` | Validates plan structure (sections, phase numbering, task metadata, wave consistency). |
| `manage-cache.ts` | Invalidates and trims explore-cache.md. |
| `setup-worktree.ts` | Creates a git worktree for isolated plan execution. |
| `list-worktrees.ts` | Lists active devorch worktrees with status. |
| `archive-plan.ts` | Archives completed plans. |
| `phase-summary.ts` | Generates phase commit message and writes state.md in one call. |

Scripts import shared utilities from `scripts/lib/` (plan-parser, args, fs-utils, git-utils).

### Key Concepts

- **Phases** -- Sequential milestones. Phase N+1 receives a handoff summary from phase N.
- **Waves** -- Groups of tasks within a phase that run in parallel. Tasks in the same wave never modify the same file.
- **Tasks** -- Atomic units of work assigned to individual builder agents.
- **Explore cache** -- Summaries from Explore agents, reused across phases to avoid redundant exploration.
- **State tracking** -- `state.md` tracks the last completed phase and handoff summary.
- **Worktrees** -- Each plan executes in an isolated git worktree. Merged back on success.
- **Satellite repos** -- Plans can span multiple repositories. Secondary repos get their own worktrees with the same branch name, and merge is coordinated across all repos.

---

## Commands Reference

| Command | What it does | Uses agents |
|---------|-------------|-------------|
| `/devorch` | Unified entry. Triages to quick/scoped/full, applies guardian pass, executes at scope-appropriate ceremony. | Explore, Builder |
| `/devorch:worktrees` | List, merge, or delete devorch worktrees. | -- |

---

## Project Structure

```
devorch/
  commands/          # slash command definitions (.md)
  agents/            # agent type definitions (.md)
  scripts/           # TypeScript utilities (Bun)
    lib/             # shared modules (plan-parser, args, fs-utils)
  docs/              # philosophy, archived references
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
  version: 3.0.0
  description: Multi-agent orchestration framework for Claude Code (v3: unified /devorch command, scope-proportional ceremony, guardian-by-default)
  license: MIT
  runtime: Bun
  language: TypeScript

capabilities:
  - Phased plan creation from natural language descriptions
  - Parallel builder agent deployment in waves
  - Quick per-phase checks (build, typecheck) with full validation at end
  - Adversarial final verification (security, quality, completeness reviewers)
  - State tracking with cross-session resumption
  - Codebase exploration via parallel Explore agents
  - Convention-aware code generation
  - Git worktree isolation per plan
  - Multi-repo orchestration with satellite worktrees

commands:
  - name: devorch
    signature: /devorch [--quick|--full|--resume|--worktree] "<description>"
    purpose: Unified entry — triage (quick/scoped/full), guardian pass, execute at scope-appropriate ceremony
    status: active
  - name: worktrees
    signature: /devorch:worktrees
    purpose: List, merge, or delete devorch worktrees
    status: active

architecture:
  agents:
    - name: devorch-builder
      role: Implements one task, writes code, validates, commits
      model: opus
      mode: read-write
  scripts:
    - init-phase.ts (phase context loading)
    - check-project.ts (lint + typecheck + build + test; --quick for per-phase)
    - map-project.ts (tech stack and structure collection)
    - map-conventions.ts (code pattern analysis)
    - validate-plan.ts (plan structure validation)
    - manage-cache.ts (explore cache management)
    - setup-worktree.ts (worktree creation)
    - list-worktrees.ts (worktree listing)
    - archive-plan.ts (plan archival)
    - phase-summary.ts (phase commit message and state generation)
  shared_lib:
    - scripts/lib/plan-parser.ts (plan file parsing utilities)
    - scripts/lib/args.ts (CLI argument parsing)
    - scripts/lib/fs-utils.ts (file system utilities)
    - scripts/lib/git-utils.ts (git utilities: branch detection, status checks)

key_concepts:
  - phase: Sequential milestone, max 5 tasks, handoff summary to next phase
  - wave: Parallel task group within a phase, no shared file modifications
  - task: Atomic work unit assigned to one builder agent
  - explore_cache: Reusable Explore agent summaries (.devorch/explore-cache-<name>.md)
  - state: Last completed phase tracked in .devorch/state.md
  - worktree: Isolated git worktree per plan, merged on success
  - satellite_repo: Secondary repo included in a multi-repo plan, gets its own worktree

state_files:
  - path: .devorch/ARCHITECTURE.md
    purpose: Architecture design (generated by /devorch for new projects)
  - path: .devorch/CONVENTIONS.md
    purpose: Coding conventions, auto-generated on first run
  - path: .devorch/explore-cache-<name>.md
    purpose: Cached Explore agent summaries (per-plan, where <name> is the plan name)
  - path: .devorch/plans/<name>.md
    purpose: Active plan (where <name> is the plan name)
  - path: .devorch/plans/archive/
    purpose: Completed plans (auto-archived)
  - path: .devorch/state.md
    purpose: Last completed phase and handoff summary

file_structure:
  source:
    - commands/ (2 .md slash command definitions)
    - agents/ (1 .md agent type definition)
    - scripts/ (10 .ts utility scripts + lib/)
    - docs/ (philosophy, archived references)
    - hooks/ (post-edit lint + statusline)
    - install.ts (installer)
    - uninstall.ts (uninstaller)
  installed:
    - ~/.claude/commands/devorch/ (commands)
    - ~/.claude/agents/ (agent definitions)
    - ~/.claude/devorch-scripts/ (utility scripts)
    - ~/.claude/hooks/ (hooks)
```
