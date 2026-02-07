# Explore Cache
Generated: 2026-02-07T00:00:00Z

## Agent System (Builder + Validator)
Builder (devorch-builder.md): model opus, cyan color, PostToolUse hook for lint. Executes ONE task, gets context inline (no TaskGet), explores if needed, implements, validates via check-project.ts, commits specific files, marks TaskUpdate completed as final action. Validator (devorch-validator.md): model opus, yellow color, disallowedTools: Write/Edit/NotebookEdit. Read-only: runs validation commands, verifies criteria, reports PASS/FAIL with evidence.

## Scripts Pipeline
8 scripts in scripts/: check-project.ts (lint/typecheck/build/test runner, JSON output), extract-phase.ts (single-phase extraction, ~30-40% token savings), extract-criteria.ts (criteria/validation parsing to JSON), hash-plan.ts (SHA-256 integrity), map-conventions.ts (code pattern analysis), validate-plan.ts (structure validation, returns "continue"/"block"), map-project.ts (project overview), check-agent-teams.ts (Agent Teams feature flag validation + team template parsing from .devorch/team-templates.md, returns JSON with {enabled, instructions?, templates}). All use Bun APIs, JSON stdout, no npm deps.

## Hooks System
post-edit-lint.ts: PostToolUse hook on Write/Edit, runs biome or eslint on modified file, exit 1 on errors. devorch-statusline.cjs: Shows project name + context bar (green/yellow/orange/red based on usage).

## State Management
state.md: current phase summary only (overwritten per phase). state-history.md: append-only archive of previous phase summaries. explore-cache.md: exploration summaries, invalidated when builders change cached files, trimmed at 3000 lines. Plans lifecycle: current.md → archive/<timestamp>-<name>.md on completion. State deleted on new plan creation. State title must match plan title or is ignored as stale.

## Install System
install.ts: copies commands/ → ~/.claude/commands/devorch/, agents/ → ~/.claude/agents/, scripts/ → ~/.claude/devorch-scripts/, hooks/ → ~/.claude/hooks/. Template substitution: $CLAUDE_HOME → actual path (forward slashes on Windows). Statusline config in settings.json. Uses directory iteration — new files in existing directories are picked up automatically.

## Existing Commands (Agent Teams Integration)
make-plan.md: 12 steps (was 11). Step 3 "Agent Teams exploration (conditional)" added after Classify. Runs check-agent-teams.ts, checks --team flag in $ARGUMENTS. If --team AND not enabled → error with instructions. If enabled AND (--team OR complexity=complex) → spawns make-plan-team (2 analysts: scope-explorer + risk-assessor) via TeammateTool spawnTeam. Otherwise skips. Supplements existing Explore agents, does not replace them. All original steps preserved and renumbered. check-implementation.md: 6 steps (was 5). Step 4 "Adversarial review (conditional)" added after Verify and check. Only triggers on --team flag. Runs check-agent-teams.ts, spawns check-team (3 reviewers: security + quality + performance) via TeammateTool spawnTeam. Adversarial Review section added to report template. Without --team flag, behavior identical to before.

## Agent Teams API
Experimental feature gated by CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. TeammateTool operations: spawnTeam, discoverTeams, requestJoin, approveJoin, rejectJoin, write, broadcast, requestShutdown, approveShutdown, rejectShutdown, cleanup, approvePlan, rejectPlan. Teammates are independent Claude Code sessions communicating via direct messages and shared task lists. Hooks: TeammateIdle (fires when teammate goes idle, exit 2 to keep working), TaskCompleted (fires on task completion, exit 2 to block). In-process mode: all teammates in main terminal, Shift+Up/Down to switch. No nested teams. No session resumption for teammates. Higher token cost than subagents.
