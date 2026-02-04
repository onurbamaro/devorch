# devorch

Multi-agent orchestration framework for Claude Code. Structures development into phased plans with parallel task execution, automatic validation, and state tracking.

## Install

```bash
bun run install.ts
```

Copies commands, agents, scripts, and hooks to `~/.claude/`. Use `--force-statusline` to override an existing statusline config.

```bash
bun run uninstall.ts
```

## Workflows

### New project

```
/devorch:new-idea          # Q&A to define product, tech stack, MVP scope
                           # generates .devorch/PROJECT.md, ARCHITECTURE.md, CONVENTIONS.md

/devorch:make-plan "..."   # plan the first milestone
/devorch:build 1           # execute phase 1
/devorch:build 2           # execute phase 2, and so on
```

### Existing project

```
/devorch:map-codebase      # analyze codebase, generate PROJECT.md + CONVENTIONS.md
/devorch:make-plan "..."   # plan the work
/devorch:build 1           # execute phases sequentially
```

### Quick fix (1-3 files)

```
/devorch:quick "fix the login redirect bug"
```

Direct implementation with auto-commit. Redirects to `/make-plan` if scope exceeds 3 files.

### Adding tests

```
/devorch:plan-tests        # analyze code, write .devorch/plans/tests.md
/devorch:make-tests        # generate and run tests from the plan
```

## How it works

### Planning (`/make-plan`)

Classifies work by type, complexity, and risk. Explores the codebase proportionally using parallel Explore agents. Produces a plan with:

- **Phases** - sequential milestones, max 5 tasks each
- **Waves** - groups of tasks within a phase that run in parallel
- **Tasks** - atomic units assigned to builder agents

Rules: tasks in the same wave cannot modify the same file or depend on each other. Validation is always the last wave.

### Execution (`/build`)

Per phase:

1. Extracts the phase from the plan (with handoff from previous phase)
2. Launches Explore agents to gather codebase context
3. Deploys builder agents in parallel waves, each receiving only the context relevant to its task
4. Runs validation (commands + acceptance criteria + validator agent)
5. Updates `.devorch/state.md` with progress

The orchestrator never reads source files directly. All codebase exploration goes through Explore agents to preserve context.

### Agents

| Agent | Role | Model |
|-------|------|-------|
| `devorch-builder` | Implements one task. Writes code, validates, commits. | opus |
| `devorch-validator` | Verifies task completion. Read-only. | sonnet |

Builders get a post-edit lint hook that runs biome/eslint after every Write/Edit.

### Scripts

| Script | Purpose |
|--------|---------|
| `check-project.ts` | Runs lint, typecheck, build, test. Returns JSON results. |
| `extract-phase.ts` | Extracts a single phase from a plan file (saves ~30-40% tokens). |
| `map-project.ts` | Collects tech stack, folder structure, dependencies, scripts, git history. |
| `map-conventions.ts` | Analyzes naming, exports, style, testing patterns from code samples. |
| `validate-plan.ts` | Validates plan structure (sections, phase numbering, task metadata). |

### State tracking

`.devorch/state.md` tracks which phase was last completed and stores summaries used as handoff context for the next phase.

The statusline hook (`devorch-statusline.cjs`) shows the active task, phase progress bar, and context usage in the Claude Code status bar.

## Commands reference

| Command | What it does | Uses agents |
|---------|-------------|-------------|
| `/devorch:new-idea` | Guided Q&A for new projects. Generates context files. | Explore (on demand) |
| `/devorch:map-codebase` | Maps existing project. Generates PROJECT.md + CONVENTIONS.md. | Explore |
| `/devorch:make-plan` | Creates phased plan with team and wave structure. | Explore |
| `/devorch:build N` | Executes one phase. Deploys builders in parallel waves. | Explore, Builder, Validator |
| `/devorch:quick` | Small fix (1-3 files) with auto-commit. | None |
| `/devorch:plan-tests` | Plans testing strategy per module. | Explore |
| `/devorch:make-tests` | Generates and runs tests from the test plan. | Explore, Builder |

## Project structure

```
devorch/
  commands/          # slash command definitions (.md)
  agents/            # agent profiles (.md)
  scripts/           # TypeScript utilities
  hooks/             # post-edit lint + statusline
  install.ts         # installer
  uninstall.ts       # uninstaller
```

Installed to:

```
~/.claude/
  commands/devorch/  # commands
  agents/            # agent profiles
  devorch-scripts/   # utility scripts
  hooks/             # hooks
```

Per-project state:

```
.devorch/
  PROJECT.md         # project overview, tech stack, architecture
  CONVENTIONS.md     # coding conventions
  ARCHITECTURE.md    # (new projects only, from /new-idea)
  plans/
    current.md       # active plan
    tests.md         # test plan
  state.md           # phase progress + handoff context
```

## Context isolation

The orchestrator (`/build`, `/make-plan`, etc.) never reads source code files directly. All codebase exploration happens through Explore subagents, whose summaries are filtered per-builder based on task relevance. This keeps the orchestrator's context focused on coordination.

| Layer | Reads source files | Reads devorch files |
|-------|-------------------|-------------------|
| Orchestrator | No (Explore agents only) | Yes |
| Explore agents | Yes | No |
| Builder agents | Yes (own task scope) | Via prompt |
| Validator agent | Yes (verification) | Yes |

## Commit conventions

| Context | Format |
|---------|--------|
| Map/plan | `chore(devorch): ...` |
| Phase completion | `phase(N): <goal>` |
| Builder task | `feat\|fix\|refactor\|chore(scope): description` |
| Tests | `test(scope): ...` |
| Quick fix | `feat\|fix\|refactor\|chore\|docs(scope): description` |

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai/claude-code) CLI
