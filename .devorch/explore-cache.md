# Explore Cache
Generated: 2026-02-18T12:00:00Z

## Check-Implementation Flow
check-implementation.md runs as Step 3 of build.md (inline, not as Task). Six steps: (1) extract-criteria.ts loads all criteria/validation/files, (2) git diff for changed files baseline, (3) parallel verify: check-project.ts + verify-build.ts + validation commands + tally-criteria.ts + one Explore agent for cross-phase integration, (4) optional adversarial review via Agent Teams (3 reviewers: security/quality/performance), (5) structured report with verdict PASS/FAIL, (6) follow-up: if FAIL, lists `/devorch:quick <fix>` suggestions for user to paste manually. No automatic retry, no loopback, no AskUserQuestion. Hardcoded `.devorch/plans/current.md` in steps 1-2 — gap when called from worktree context (build.md passes planPath but check-implementation.md doesn't parameterize all paths).

## Build.md Worktree Logic
Step 0 resolves --plan: bare name → `.worktrees/<name>/.devorch/plans/current.md`, sets projectRoot and isWorktree. Steps 1-4 scope all file refs to `<projectRoot>/.devorch/`. Step 5 (merge worktree): conditional on isWorktree, detects branch, shows git log preview, AskUserQuestion "Merge now" vs "Keep worktree". Merge: checkout main → merge → worktree remove → branch -d. Conflicts reported to user.

## Make-Plan Worktree Logic
Step 1: If current.md exists and in-progress, AskUserQuestion: "Archive" vs "Run in parallel worktree". worktreeMode=true deferred to Step 8. Step 8 (worktreeMode): derive kebab name → setup-worktree.ts → write plan to worktree → copy CONVENTIONS + explore-cache → set planPath. Step 11: two commits (worktree branch + main). Step 12: show `/clear\n/devorch:build --plan <name>`. Non-worktree path writes directly to `.devorch/plans/current.md`.

## Build-Phase Cache Lifecycle
Step 1: init-phase.ts reads filtered explore-cache (relative to cwd). Step 2: checks cache coverage before launching new Explore agents. Step 8: appends new explore summaries to `.devorch/explore-cache.md`, then runs `manage-cache.ts --action invalidate,trim --max-lines 3000`. All paths relative to cwd (no mainRoot awareness).

## Setup-Worktree Script
Creates `.worktrees/<name>` with branch `devorch/<name>`. Ensures .worktrees/ in .gitignore. Copies ALL uncommitted .devorch/ files (git diff + git ls-files --others). Output: `{"worktreePath": ".worktrees/<name>", "branch": "devorch/<name>", "devorch": true|false}`. No filtering of which .devorch/ files to copy.

## Init-Phase Script
Reads plan file, conventions, state, explore-cache all relative to plan directory. Filters cache by phase file paths. Outputs JSON with content or contentFile (>25000 chars). No --cache-root flag — always reads cache from same directory as plan.

## Manage-Cache Script
Resolves cache as `process.cwd()/.devorch/explore-cache.md`. Invalidation uses `git diff --name-only HEAD~1..HEAD`. Trim removes oldest sections first. No --root flag — always operates on cwd.

## Quick Command
Binary 5-item checklist gate: ≤3 files, no API changes, no new deps, existing coverage, mechanically verifiable. If any NO → stops, suggests make-plan. If all YES → Explore agent to understand code, implement, check-project.ts, auto-commit. Format: `feat|fix|refactor|chore|docs(scope): description`.

## Validator Agent
devorch-validator is read-only (Write/Edit/NotebookEdit disallowed). Runs validation commands, inspects files for acceptance criteria, reports PASS/FAIL. Context pre-injected by phase agent. Does NOT run check-project.ts.

## Agent Definitions
devorch-builder (opus, cyan): PostToolUse hook for post-edit-lint. Receives all context in prompt (no TaskGet). Runs check-project.ts before commit. Commits task files only. TaskUpdate(completed) as absolute last action. Max 3-line output.

## Install System
install.ts copies: scripts/ to ~/.claude/devorch-scripts/, commands/ to ~/.claude/commands/devorch/, templates/ to ~/.claude/devorch-templates/, agents/ to ~/.claude/agents/, hooks/ to ~/.claude/hooks/. Cleans dest dirs before copying (rmSync recursive). $CLAUDE_HOME substitution in .md files only (replaces with ~/.claude path, forward slashes on Windows). Sets statusline in settings.json.

## List-Worktrees (does not exist yet)
No existing script. `.worktrees/` directory is gitignored. Each worktree has `.devorch/plans/current.md` (plan), `.devorch/state.md` (status). Branch name recoverable via `git -C .worktrees/<name> branch --show-current`.
