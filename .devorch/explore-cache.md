# Explore Cache
Generated: 2026-03-15T12:00:00Z

## Agent/Task Call Patterns
11 distinct call sites across the codebase. None use effort parameters — all inherit `model: opus` from frontmatter.

Call sites by file:
- `commands/talk.md`: 4 sites — CONVENTIONS generation (1-2 Explore), Agent Teams exploration (2-4 Explore parallel single message), deep exploration (Explore), general rule (Explore only)
- `commands/build.md`: 3 sites — phase execution (1 general-purpose per phase, sequential), review agents (4 Explore parallel single message: 1 cross-phase + 3 adversarial), fix-level builders (devorch-builder parallel)
- `commands/fix.md`: 2 sites — investigation (2-3 Explore parallel), verification (1-2 Explore parallel conditional)
- `templates/build-phase.md`: 2 sites — builder deployment (devorch-builder parallel per wave via TaskCreate), builder ad-hoc exploration (Explore)
- `agents/devorch-builder.md`: 1 site — ad-hoc Explore during task execution

Agent tool `model` parameter only accepts: "sonnet", "opus", "haiku" — no effort level parameter available in tool definition.

## Setup-Worktree Structure
`scripts/setup-worktree.ts` (305 lines). Args: --name (required), --secondary (optional JSON), --add-secondary (optional), --recreate (optional).

Git flow: `git worktree add <path> -b <branch>` → copy uncommitted .devorch/ files → ensure plans/ dir.
Satellite flow: validate git repo → check branch → create worktree → return SatelliteResult.
Output: JSON with worktreePath, branch, devorch flag, satellites array.

Sparse-checkout insertion point: after line 237 (worktree creation), before .devorch/ copy. Commands: `git sparse-checkout init --cone` + `git sparse-checkout set <paths>`.

## Hooks System
Two hooks exist:
- `hooks/post-edit-lint.ts` (97 lines) — PostToolUse on Write|Edit, registered in agent frontmatter
- `hooks/devorch-statusline.cjs` (55 lines) — statusLine in settings.json

Hook pattern: stdin JSON → process → stdout messages + exit code (0=ok, 1=error).
Registration: agent-specific hooks in agent .md frontmatter, global hooks in settings.json.
Install: `install.ts` copies to ~/.claude/hooks/, registers statusline in settings.json.

PostCompact hook does not exist yet. Would be global (settings.json), not agent-specific.

## Task Sizing and Context Limits
- Max 5 tasks per phase (talk.md sizing rules, line 240-245)
- CONTENT_THRESHOLD = 25000 chars in init-phase.ts (line 14) — above this, context saved to .devorch/.phase-context.md
- Explore-cache max 3000 lines (manage-cache.ts, line 23)
- Cache filtering: 2-level matching — exact file path → directory name fallback. If no refs found, returns ALL cache.
- Builders receive: objective + decisions + solution-approach + full task details + conventions (by file extension) + ALL phase-relevant explore-cache sections
- Sizing rule says "prefer more smaller phases over fewer large ones"

## Init-Phase Context Assembly Order
1. Phase name and number
2. Objective (if present)
3. Decisions (if present)
4. Solution Approach (if present)
5. Phase Content (tasks, execution, criteria, validation, test-contract, handoff)
6. Previous Handoff (from phase N-1)
7. Conventions (complete)
8. Current State (state.md)
9. Project Structure (map-project.ts output)
10. Explore Cache (filtered by file refs in tasks)

## Plan Parser Utilities
`scripts/lib/plan-parser.ts` (103 lines) provides:
- `extractTagContent(text, tag)` — extracts content between XML tags
- `extractFileEntries(block)` — returns {path, description}[] from relevant-files/new-files
- `parsePhaseBounds(content)` — returns PhaseBounds[] with start/end lines per phase
- `readPlan(planPath)` — reads and returns plan content
- `extractPlanTitle(content)` — extracts plan title from `# Plan: <title>`
- `extractSecondaryRepos(content)` — extracts secondary repos from plan
