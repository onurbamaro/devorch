# Explore Cache
Generated: 2026-02-17T00:00:00Z

## Scripts Architecture
All 8 existing scripts in devorch/scripts/ follow identical conventions: JSDoc header, parseArgs() function for CLI args (manual for-loop over process.argv.slice(2) with --flag value pattern), Node.js stdlib imports only (fs, path, crypto), JSON output via console.log(JSON.stringify()), exit 1 for bad args, exit 0 for success. Bun.spawn/Bun.spawnSync for subprocesses. No shared modules — each script is self-contained. Output formats: JSON for structured data, Markdown for human-readable context. Key pattern: config-driven detection (arrays of CheckDef-like objects), regex-based XML tag parsing, single-pass algorithms.

Scripts roster: map-project.ts (project mapping, Markdown output), map-conventions.ts (code pattern analysis, Markdown), extract-phase.ts (phase extraction from plan, Markdown), extract-criteria.ts (criteria+validation extraction, JSON), check-project.ts (lint/typecheck/build/test runner, JSON), validate-plan.ts (plan structure validation, JSON with result:"continue"|"block"), hash-plan.ts (SHA-256 integrity, JSON), check-agent-teams.ts (feature flag + templates, JSON).

## Command Integration Points
build.md: Thin supervisor, reads state.md for resume point, reads build-phase.md template, launches Task per phase (foreground, general-purpose), verifies state after each phase, runs check-implementation.md at end. Zero direct script calls.

build-phase.md (template): Per-phase executor. Calls extract-phase.ts for phase content. Reads CONVENTIONS.md, explore-cache.md, state.md separately. Manually parses execution block for wave structure. Launches builders as parallel Task calls per wave. Manually writes state.md and appends to state-history.md. Manually invalidates explore-cache via git diff. Manually formats phase commit message.

make-plan.md: Calls map-project.ts, check-agent-teams.ts, validate-plan.ts. Manually archives plans (reads state, moves files). Manually manages explore-cache. Ends with "/clear + /devorch:build" instruction.

check-implementation.md: Calls extract-criteria.ts, check-project.ts (background), check-agent-teams.ts (conditional). Launches parallel Explore agents per phase + convention + cross-phase. Updates state.md to "completed" on PASS.

## Agent Definitions
devorch-builder (opus, cyan): PostToolUse hook for post-edit-lint. Receives all context in prompt (no TaskGet). Runs check-project.ts before commit. Commits task files only. TaskUpdate(completed) as absolute last action. Max 3-line output.

devorch-validator (opus, yellow): Read-only (disallowed: Write, Edit, NotebookEdit). Receives criteria + validation commands + task summaries inline. Reports PASS/FAIL. Does NOT run check-project.ts.

## Install System
install.ts copies: scripts/ to ~/.claude/devorch-scripts/, commands/ to ~/.claude/commands/devorch/, templates/ to ~/.claude/devorch-templates/, agents/ to ~/.claude/agents/, hooks/ to ~/.claude/hooks/. Cleans dest dirs before copying (rmSync recursive). $CLAUDE_HOME substitution in .md files only (replaces with ~/.claude path, forward slashes on Windows). Sets statusline in settings.json.

## Project Structure
- commands/ — 9 .md files (build, build-tests, check-implementation, debug, explore-deep, make-plan, plan-tests, quick, review)
- agents/ — 2 .md files (devorch-builder, devorch-validator)
- scripts/ — 8 .ts files (check-agent-teams, check-project, extract-criteria, extract-phase, hash-plan, map-conventions, map-project, validate-plan)
- hooks/ — 2 files (devorch-statusline.cjs, post-edit-lint.ts)
- templates/ — 1 .md file (build-phase.md)
- Root: install.ts, uninstall.ts, package.json, README.md, tsconfig.json, bun.lock
