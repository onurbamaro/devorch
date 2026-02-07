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
/devorch:new-idea          # guided Q&A — generates .devorch/PROJECT.md, ARCHITECTURE.md
/devorch:map-codebase      # generates CONVENTIONS.md (run after first build phase)

/devorch:make-plan "..."   # plan the first milestone
/devorch:build-all         # execute all phases + verify
```

### Existing project

```
/devorch:map-codebase      # analyze codebase → CONVENTIONS.md
/devorch:make-plan "..."   # plan the work
/devorch:build-all         # execute all phases + verify
```

### One phase at a time

```
/devorch:build 1           # execute phase 1
/devorch:build 2           # execute phase 2
/devorch:check-implementation  # verify everything after last phase
```

### Resume interrupted build

```
/devorch:resume            # reads state.md, offers: next phase / build-all / check
```

### Quick fix

```
/devorch:quick "fix the login redirect bug"
```

Direct implementation with auto-commit. Redirects to `/make-plan` if complexity exceeds a quick fix.

### Testing

```
/devorch:plan-tests        # analyze code → .devorch/plans/tests.md
/devorch:make-tests        # generate and run tests from the plan
```

## How it works

### Planning (`/make-plan`)

Classifies work by type, complexity, and risk. Asks clarifying questions (with clickable options) before exploring. Explores the codebase proportionally using parallel Explore agents. Produces a validated plan with:

- **Phases** — sequential milestones, max 5 tasks each
- **Waves** — groups of tasks within a phase that run in parallel
- **Tasks** — atomic units assigned to builder agents

Rules: tasks in the same wave cannot modify the same file or depend on each other. Validation is always the last wave.

Completed plans are auto-archived when creating a new plan. In-progress plans require user confirmation.

### Execution (`/build`, `/build-all`)

`/build` executes one phase. `/build-all` loops through all remaining phases sequentially, then runs `/check-implementation`.

Per phase:

1. Verifies plan integrity (hash check — detects modifications since validation)
2. Extracts the phase and loads handoff context from previous phase
3. Launches Explore agents for uncovered codebase areas (results cached in `explore-cache.md`)
4. Deploys builder agents in parallel waves (`run_in_background`), each receiving only relevant context
5. Polls until all builders in a wave complete, then launches next wave
6. Runs validator agent (acceptance criteria + validation commands)
7. Commits, invalidates stale cache entries, updates `state.md`

Failed builders get one automatic retry with diagnostic context from the first failure.

The orchestrator never reads source files directly. All codebase exploration goes through Explore agents to preserve context.

### Verification (`/check-implementation`)

Post-build verification that runs automatically at the end of `/build-all`, or manually at any time.

All checks run in a single parallel batch:

- **Per-phase functional agents** — one Explore agent per completed phase, verifying acceptance criteria with file:line evidence
- **Convention compliance agent** — checks all changed files against CONVENTIONS.md
- **Cross-phase integration agent** — verifies imports resolve, no orphan exports, no TODOs, type consistency, handoff contracts honored
- **Automated checks** — lint, typecheck, build, test (background, concurrent with Explore agents)
- **Phase validation commands** — per-phase commands from the plan

For a 3-phase plan: 5 Explore agents + automated checks, all concurrent.

### Agents

| Agent | Role | Model | Mode |
|-------|------|-------|------|
| `devorch-builder` | Implements one task. Writes code, validates, commits. | opus | read-write |
| `devorch-validator` | Verifies phase completion against acceptance criteria. | opus | read-only |

Builders get a post-edit lint hook that runs the project linter after every Write/Edit, catching errors immediately rather than at commit time.

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

### State tracking

`.devorch/state.md` tracks the last completed phase and stores a concise summary used as handoff context for the next phase. Only the latest phase summary lives in `state.md` — previous summaries are appended to `state-history.md` to prevent context bloat.

The statusline hook (`devorch-statusline.cjs`) shows the active task, phase progress bar, and context usage in the Claude Code status bar.

## Commands reference

| Command | What it does | Uses agents |
|---------|-------------|-------------|
| `/devorch:new-idea` | Guided Q&A for new projects. Generates PROJECT.md + ARCHITECTURE.md. | Explore (on demand) |
| `/devorch:map-codebase` | Maps existing project. Generates CONVENTIONS.md. | Explore |
| `/devorch:make-plan` | Creates phased plan with wave structure. Auto-archives completed plans. | Explore |
| `/devorch:build N` | Executes one phase. Deploys builders in parallel waves. | Explore, Builder, Validator |
| `/devorch:build-all` | Executes all remaining phases + runs check-implementation. | Explore, Builder, Validator |
| `/devorch:check-implementation` | Verifies full implementation against all criteria. | Explore |
| `/devorch:resume` | Reads state, offers next action (build next / build-all / check). | None |
| `/devorch:quick` | Small fix with auto-commit. Escalates to make-plan if complex. | Explore |
| `/devorch:plan-tests` | Plans testing strategy per module. | Explore |
| `/devorch:make-tests` | Generates and runs tests from the test plan. | Explore, Builder |

## Project structure

```
devorch/
  commands/          # slash command definitions (.md)
  agents/            # agent type definitions (.md)
  scripts/           # TypeScript utilities (Bun)
  hooks/             # post-edit lint + statusline
  install.ts         # installer
  uninstall.ts       # uninstaller
```

Installed to:

```
~/.claude/
  commands/devorch/  # commands
  agents/            # agent type definitions
  devorch-scripts/   # utility scripts
  hooks/             # hooks
```

Per-project state (gitignore-friendly):

```
.devorch/
  PROJECT.md         # project overview, tech stack
  ARCHITECTURE.md    # architecture design (from /new-idea)
  CONVENTIONS.md     # coding conventions (from /map-codebase)
  explore-cache.md   # cached Explore agent summaries (reused across phases)
  plans/
    current.md       # active plan
    tests.md         # test plan
    archive/         # completed plans (auto-archived)
  state.md           # last completed phase + handoff summary
  state-history.md   # previous phase summaries (append-only)
```

## Context isolation

The orchestrator (`/build`, `/make-plan`, etc.) never reads source code files directly. All codebase exploration happens through Explore subagents, whose summaries are filtered per-builder based on task relevance. This keeps the orchestrator's context focused on coordination.

| Layer | Reads source files | Reads devorch files |
|-------|-------------------|-------------------|
| Orchestrator | No (Explore agents only) | Yes |
| Explore agents | Yes | No |
| Builder agents | Yes (own task scope) | Via prompt |
| Validator agent | Yes (verification) | Via prompt |

## Parallelism

| Level | Strategy |
|-------|----------|
| Phases | Sequential (phase N+1 depends on N's handoff) |
| Builders within phase | Parallel waves via `run_in_background` |
| Explore agents | Parallel (one per area) |
| Verification (check-implementation) | All Explore agents + automated checks in one concurrent batch |
| lint + typecheck (check-project.ts) | `Promise.all` |

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
