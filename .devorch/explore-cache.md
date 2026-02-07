# Explore Cache
Generated: 2026-02-07T00:00:00Z

## Command Files Structure
All 10 command files in commands/. YAML frontmatter: description, model (opus), optional argument-hint, hooks, disallowed-tools. Commands reference scripts via `bun $CLAUDE_HOME/devorch-scripts/<name>.ts` and dispatch agents via `subagent_type=devorch-builder|devorch-validator|Explore|general-purpose`. Key patterns: Explore agents for code analysis, builders for implementation (background, wave-based), validators for verification (read-only, foreground). make-plan.md has disallowed-tools: EnterPlanMode. build.md takes phase number argument. check-implementation.md launches 5+ parallel agents. All commands follow: load context → explore → execute → validate → commit → report.

## Agent System (Builder + Validator)
Builder (devorch-builder.md): model opus, cyan color, PostToolUse hook for lint. Executes ONE task, gets context inline (no TaskGet), explores if needed, implements, validates via check-project.ts, commits specific files, marks TaskUpdate completed as final action. Validator (devorch-validator.md): model opus, yellow color, disallowedTools: Write/Edit/NotebookEdit. Read-only: runs validation commands, verifies criteria, reports PASS/FAIL with evidence.

## Scripts Pipeline
7 scripts in scripts/: check-project.ts (lint/typecheck/build/test runner, JSON output), extract-phase.ts (single-phase extraction, ~30-40% token savings), extract-criteria.ts (criteria/validation parsing to JSON), hash-plan.ts (SHA-256 integrity), map-conventions.ts (code pattern analysis), validate-plan.ts (structure validation, returns "continue"/"block"), map-project.ts (project overview). All use Bun APIs, JSON stdout, no npm deps.

## Hooks System
post-edit-lint.ts: PostToolUse hook on Write/Edit, runs biome or eslint on modified file, exit 1 on errors. devorch-statusline.cjs: Shows project name + context bar (green/yellow/orange/red based on usage).

## State Management
state.md: current phase summary only (overwritten per phase). state-history.md: append-only archive of previous phase summaries. explore-cache.md: exploration summaries, invalidated when builders change cached files, trimmed at 3000 lines. Plans lifecycle: current.md → archive/<timestamp>-<name>.md on completion. State deleted on new plan creation. State title must match plan title or is ignored as stale.

## Install System
install.ts: copies commands/ → ~/.claude/commands/devorch/, agents/ → ~/.claude/agents/, scripts/ → ~/.claude/devorch-scripts/, hooks/ → ~/.claude/hooks/. Template substitution: $CLAUDE_HOME → actual path (forward slashes on Windows). Statusline config in settings.json. Uses directory iteration — new files in existing directories are picked up automatically.

## Agent Teams API
Experimental feature gated by CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. TeammateTool operations: spawnTeam, discoverTeams, requestJoin, approveJoin, rejectJoin, write, broadcast, requestShutdown, approveShutdown, rejectShutdown, cleanup, approvePlan, rejectPlan. Teammates are independent Claude Code sessions communicating via direct messages and shared task lists. Hooks: TeammateIdle (fires when teammate goes idle, exit 2 to keep working), TaskCompleted (fires on task completion, exit 2 to block). In-process mode: all teammates in main terminal, Shift+Up/Down to switch. No nested teams. No session resumption for teammates. Higher token cost than subagents.
