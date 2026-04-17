[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1.svg)](https://bun.sh)
[![Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-6B4FBB.svg)](https://claude.ai/claude-code)

# devorch

**Multi-agent orchestration for Claude Code — one command, ceremony proportional to scope.**

You describe what you want built. devorch classifies the request, acts as a senior engineer pair checking it against industry standards, and executes at the overhead level the work actually deserves. Typos get a direct edit. Multi-module features get a worktree, a phased plan, parallel waves, and a final adversarial review. Nothing in between pays for ceremony it does not need.

---

## Why devorch

**One command, three modes** — `/devorch "<what you want>"` triages into `quick` (direct edit), `scoped` (single explore + gate), or `full` (worktree, phases, waves, review). Flags `--quick` / `--full` override the classifier when you disagree.

**Guardian posture by default** — Every invocation runs a senior-engineer sweep against OWASP, performance, architecture, and operations standards. Silent when the code is correct; loud when it catches a known-right answer (SQL concatenation, N+1, missing idempotency, proxy upload of a 30MB blob).

**Filtered context per builder** — In `full` mode, each builder agent gets a curated slice (typical 6–10K tokens: conventions + cache + specs + code structure, all filtered by task). Slices under 3K or over 30K pause for human review before builders dispatch.

**Coordinated multi-repo** — Plans can span sibling repos (e.g., `../dochron/` and `../dochron-mobile/`). Satellite worktrees are created automatically in F1, builders route per repo, and merge runs a dry-run across every repo before committing any — atomicity guard built in.

**State-aware resumption** — Interrupted mid-build? `/devorch --resume` picks up at the next incomplete phase without rebuilding context from scratch.

---

## Quick Start

```bash
bun install
```

That runs `install.ts`, copying `/devorch` to `~/.claude/commands/devorch.md`, the builder agent and scripts to their respective directories, and wiring the post-compact and post-edit hooks.

### Your first invocation

```bash
/devorch "add user authentication with JWT"
```

Triage classifies, the guardian runs, you see a transparency block of considered edge cases and any real bifurcations, answer a single gate question, then the pipeline executes. On first run in a new project, devorch auto-generates `.devorch/CONVENTIONS.md` from your code before planning.

---

## What You Can Do

### Small fix

```
/devorch "fix the login redirect bug"
```

Triage picks `quick` or `scoped`. No worktree, no plan — direct edit, guardian sweep, lint hook on write, commit.

### New feature

```
/devorch "add real-time order dashboard with delta sync"
```

Triage picks `full`. Worktree created, 2–3 parallel Explore agents, plan drafted following `docs/PLAN-FORMAT.md`, waves dispatched, per-phase quick check, final review with four categorized reviewers (security, performance, completeness, flags), coordinated merge.

### Multi-repo work

```
/devorch "sync timezone handling between dochron and dochron-mobile"
```

Guardian detects sibling repos. Gate asks which to include as satellites. Each satellite gets its own worktree with the matching branch name. Builders route by task `Repo:` field. Merge runs dry-run across all repos first, then commits sequentially.

### Resume an interrupted build

```
/devorch --resume
```

Lists active worktrees (if more than one), picks up at the next incomplete phase, carries forward state, and continues.

### Force a mode

```
/devorch --quick "rename UserProfile to UserProfileCard across the repo"
/devorch --full  "refactor the auth module to support OAuth2"
```

---

## How It Works

`/devorch` is a single unified entry with three internal modes:

1. **`quick`** — Direct edit. No plan, no worktree. The orchestrator classifies, runs a guardian sweep, edits, lets the post-edit lint hook fire, and commits. For typos, renames, and isolated small fixes.

2. **`scoped`** — Targeted change with one Explore agent. Edge cases are enumerated into three buckets (resolved-by-code, resolved-by-request, real-bifurcation). A single gate surfaces bifurcations with recommendations. Execute, validate with `check-project --quick`, commit.

3. **`full`** — Phased execution. Worktree, parallel explorations, validated plan, builder waves per phase, per-phase check, final adversarial review (security + performance + completeness + flags), coordinated merge across primary + satellites.

Every mode runs the guardian, the post-edit lint hook, and the F9 flow-friction capture before stopping.

### Single agent type

| Agent | Role | Model | Effort |
|-------|------|-------|--------|
| `devorch-builder-deep` | Implements one task with contract-map + spec-first stubs + self-verification. | opus | high |

Builders run in isolated contexts with the post-edit lint hook bound to `Write`/`Edit`, so style and type errors surface immediately — not at commit time.

### Scripts

| Script | Purpose |
|--------|---------|
| `init-phase.ts` | Loads phase context: objective, decisions, conventions slice, explore cache slice, code structure, specs, non-goals, exemplars. Emits `sliceWarnings` for tasks outside the 3K–30K size gate. |
| `check-project.ts` | Runs lint + typecheck + build + test in parallel. `--quick` variant runs only build + typecheck. |
| `check-conventions-staleness.ts` | Hashes convention source files; detects when CONVENTIONS.md needs regeneration. |
| `map-project.ts` | Collects tech stack, folder structure, dependencies, scripts, sibling repos. `--compact` for fast-path. |
| `map-conventions.ts` | AST-driven convention extraction (ts-morph) into CONVENTIONS.md. |
| `tldr-analyze.ts` | Structural TypeScript analysis (exports / imports / functions / types) for per-task code structure injection. |
| `validate-plan.ts` | Structural validation of plan files against `docs/PLAN-FORMAT.md`. |
| `setup-worktree.ts` | Creates primary + satellite worktrees with `--secondary` / `--add-secondary`. |
| `list-worktrees.ts` | Lists active devorch worktrees with plan, status, and satellites. |
| `phase-summary.ts` | Generates the phase commit message, writes handoff state. `--satellites` propagates per-repo status. |
| `manage-cache.ts` | Invalidates and trims the explore cache between phases. |
| `merge-worktree.ts` | Rebase → check → dry-run-all → merge sequential → cleanup. Coordinated across primary + satellites. |
| `archive-plan.ts` | Moves completed plans to `.devorch/plans/archive/` with timestamp. |

Shared utilities live in `scripts/lib/` (plan-parser, args, fs-utils, git-utils).

### Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `post-edit-lint.ts` | `PostToolUse` on `Write`/`Edit` inside the builder agent | Fails fast on syntax/style errors on every edit |
| `post-compact-state-refresh.ts` | `PostCompact` | Reloads state after automatic context compaction |
| `devorch-statusline.cjs` | `statusLine` | Shows mode and progress in the Claude Code statusline |

### Key Concepts

- **Phases** — Sequential milestones. Phase N+1 receives a handoff summary from phase N.
- **Waves** — Groups of tasks within a phase that run in parallel. Waves never share write targets (`validate-plan.ts` enforces).
- **Tasks** — Atomic work units assigned to individual builder agents.
- **Explore cache** — Summaries from Explore agents at `.devorch/explore-cache-<name>.md`, filtered per task.
- **Worktree** — Each `full` plan runs in an isolated git worktree at `.worktrees/<name>`. Merged back on success.
- **Satellite repos** — Sibling repos included as `<secondary-repos>` in a plan. Each gets its own worktree with the matching branch name. Merge is atomic (dry-run-all-first).
- **Flags** — Guardian findings that fall outside the current task scope. Written to `.devorch/flags-<plan>.md` for later action — see `docs/FLAGS.md`.
- **Flow friction inbox** — `.devorch/flow-issues-inbox/` captures devorch-flow errors with ready-to-paste `/devorch` prompts to fix them.

---

## Commands Reference

| Command | What it does | Uses agents |
|---------|-------------|-------------|
| `/devorch` | Unified entry. Triages to quick/scoped/full, applies guardian pass, executes at scope-appropriate ceremony, handles merge (including coordinated multi-repo). | Explore, Builder |

Worktree listing or deletion outside the `/devorch` flow is left to plain git (`git worktree list`, `git worktree remove <path>`, `git branch -D <branch>`). Ask Claude Code directly when you need it.

---

## Configuration

- **`.devorch/profile.yml`** — optional, global (`~/.devorch/profile.yml`) or per-project. Priority weighting for guardian bifurcations (`priorities: [performance, security, cost, dx]`) and biases. See `docs/PROFILE.md`.
- **`.devorch/standards-silenced.md`** — auto-maintained. Accepts `ciente-deixar` dismissals of repeated guardian findings to reduce noise. See `docs/FLAGS.md`.
- **`.devorch/CONVENTIONS.md`** — auto-generated from your codebase on first run; refreshed when the source files change.

---

## Project Structure

```
devorch/
  commands/          # slash command (devorch.md)
  agents/            # builder agent definition
  scripts/           # TypeScript utilities (Bun)
    lib/             # shared modules
  docs/              # philosophy, profile, flags, plan-format
  hooks/             # post-edit, post-compact, statusline
  install.ts         # installer
  uninstall.ts       # uninstaller
```

Installed to `~/.claude/`: `commands/devorch.md` (top-level), `agents/`, `devorch-scripts/`, `hooks/`. Per-project state lives in `.devorch/`.

---

## Documentation

- [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) — the nine principles and anti-principles
- [`docs/PLAN-FORMAT.md`](docs/PLAN-FORMAT.md) — plan template and validation rules
- [`docs/PROFILE.md`](docs/PROFILE.md) — `.devorch/profile.yml` format and resolution
- [`docs/FLAGS.md`](docs/FLAGS.md) — flags inbox and silenced patterns

---

## Requirements

- [Bun](https://bun.sh) runtime — required to execute the TypeScript utility scripts. Install with `curl -fsSL https://bun.sh/install | bash`.
- [Claude Code](https://claude.ai/claude-code) CLI.

---

<!-- LLM-FRIENDLY PROJECT SUMMARY -->
## For AI Agents

```yaml
project:
  name: devorch
  version: 3.0.0
  description: Multi-agent orchestration framework for Claude Code (v3: unified /devorch command, scope-proportional ceremony, guardian-by-default, coordinated multi-repo)
  license: MIT
  runtime: Bun
  language: TypeScript

capabilities:
  - Inline LLM triage classifying requests into quick/scoped/full
  - Guardian posture active in every mode (OWASP + performance + architecture + ops)
  - Edge-case enumeration with transparency-first gate UX (None/All/Numbers)
  - Phased plan creation with parallel waves in full mode
  - Filtered context per builder with size gates (3K / 30K)
  - Coordinated multi-repo merge with dry-run atomicity guard
  - State-aware resumption across sessions
  - Flow-friction capture for self-improving feedback loop

commands:
  - name: devorch
    signature: /devorch [--quick|--full|--resume|--worktree] "<description>"
    purpose: Unified entry — triage, guardian, execute, merge (including coordinated multi-repo)
    status: active

architecture:
  agents:
    - name: devorch-builder-deep
      role: Implements one task with contract-map + spec-first stubs + self-verification
      model: opus
      effort: high
      mode: read-write
  scripts:
    - init-phase.ts (phase context loading with filter gates)
    - check-project.ts (lint + typecheck + build + test; --quick for per-phase)
    - check-conventions-staleness.ts (hash-based staleness detection)
    - map-project.ts (tech stack + folder + siblings)
    - map-conventions.ts (AST-driven convention extraction)
    - tldr-analyze.ts (per-task structural TS analysis)
    - validate-plan.ts (plan structure validation)
    - setup-worktree.ts (primary + satellite worktrees)
    - list-worktrees.ts (worktree listing)
    - phase-summary.ts (phase commit message + state + satellites)
    - manage-cache.ts (explore cache maintenance)
    - merge-worktree.ts (rebase + check + dry-run-all + merge + cleanup; multi-repo)
    - archive-plan.ts (plan archival)
  shared_lib:
    - scripts/lib/plan-parser.ts
    - scripts/lib/args.ts
    - scripts/lib/fs-utils.ts
    - scripts/lib/git-utils.ts

key_concepts:
  - mode: Triage classification — quick | scoped | full
  - phase: Sequential milestone inside full mode; handoff summary to next phase
  - wave: Parallel task group within a phase; no shared file modifications
  - task: Atomic work unit assigned to one builder agent
  - slice: Per-task context slice (conventions + cache + specs + code structure)
  - slice_gate: 3K lower / 30K upper token bounds; breach pauses for human review
  - explore_cache: Reusable Explore agent summaries (.devorch/explore-cache-<name>.md)
  - worktree: Isolated git worktree per full-mode plan, merged on success
  - satellite: Secondary repo in a multi-repo plan, own worktree, matching branch
  - bifurcation: Real trade-off requiring user input; recommendations inline
  - heads_up: Guardian finding with known-right answer (redirect, not question)

state_files:
  - path: .devorch/CONVENTIONS.md
    purpose: Conventions auto-generated from the codebase
  - path: .devorch/conventions-hash.json
    purpose: Hashes for check-conventions-staleness
  - path: .devorch/profile.yml
    purpose: Optional priority/bias weighting for guardian bifurcations
  - path: .devorch/standards-silenced.md
    purpose: Accepted guardian-finding dismissals (auto-maintained)
  - path: .devorch/feedback.md
    purpose: User preference / friction log
  - path: .devorch/explore-cache-<name>.md
    purpose: Cached Explore summaries per plan
  - path: .devorch/plans/<name>.md
    purpose: Active plan in worktree
  - path: .devorch/plans/archive/
    purpose: Archived completed plans
  - path: .devorch/flags-<plan>.md
    purpose: Out-of-scope guardian findings for later action
  - path: .devorch/flow-issues-inbox/
    purpose: Ready-to-paste /devorch prompts for devorch-flow errors

file_structure:
  source:
    - commands/ (1 .md slash command: devorch.md)
    - agents/ (1 .md agent: devorch-builder-deep)
    - scripts/ (13 .ts utility scripts + lib/)
    - docs/ (4 docs: PHILOSOPHY, PLAN-FORMAT, PROFILE, FLAGS)
    - hooks/ (3 hooks: post-edit-lint, post-compact-state-refresh, devorch-statusline)
    - install.ts (installer)
    - uninstall.ts (uninstaller)
  installed:
    - ~/.claude/commands/devorch.md (top-level /devorch)
    - ~/.claude/agents/ (devorch-builder-deep)
    - ~/.claude/devorch-scripts/ (scripts + node_modules with ts-morph)
    - ~/.claude/hooks/ (devorch-statusline + post-compact-state-refresh)
```
