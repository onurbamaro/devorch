# devorch Evolution Roadmap

> Concrete improvements using new Claude Code native features.
> Each item is evaluated against PHILOSOPHY.md principles.

---

## 1. Replace manual Explore dispatch with native Agent Teams

**Current:** `/devorch` (full mode) manually launches 2-4 Explore agents with role-specific
prompts (architecture-explorer, risk-assessor, pattern-analyst) using individual
`Agent(subagent_type="Explore")` calls.

**Opportunity:** Native Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
provide built-in parallel agent coordination with session isolation, idle detection
(`TeammateIdle` hook), and completion tracking (`TaskCompleted` hook).

**What changes:**
- Replace manual Explore agent dispatch in `devorch.md` with Agent Teams invocation
- Use `TeammateIdle` and `TaskCompleted` hooks for progress tracking
- Remove manual agent result aggregation -- Agent Teams handles coordination

**What stays the same:**
- Role-specific prompts (each teammate still gets a focused exploration mandate)
- Results flow as summaries to the orchestrator (Principle 1: orchestrator stays light)
- Explore-cache still captures findings for reuse across phases

**Principles honored:** 1 (orchestrator stays light), 2 (fresh context per agent)

**Risk:** Agent Teams is still "research preview". Monitor stability before
full migration. Consider a feature flag to fall back to manual dispatch.

**Effort:** Medium -- mostly prompt restructuring, minimal script changes

---

## 2. Use `isolation: worktree` for builder agents

**Current:** Builder agents run in the orchestrator's worktree. File conflicts
between parallel builders are prevented by wave design (no shared files in same wave).

**Opportunity:** `isolation: worktree` gives each builder its own git worktree
automatically. Combined with `worktree.sparsePaths`, builders only check out
the files they need.

**What changes:**
- Add `isolation: worktree` to `devorch-builder.md` agent definition
- Use `worktree.sparsePaths` to limit checkout to task-relevant directories
- Builders commit in their isolated worktree; orchestrator merges wave results

**What stays the same:**
- Wave structure (still needed for logical grouping and dependency ordering)
- Task assignment (builders still get focused, curated context)
- Post-phase validation (runs on merged result)

**Principles honored:** 2 (even more isolated fresh context), 7 (fail fast --
merge conflicts caught at wave boundary)

**Risk:** Merge complexity increases. Need to handle conflicts when combining
worktree results back into the plan worktree. May slow down small tasks where
worktree setup overhead > execution time.

**Effort:** Medium-High -- changes to builder agent definition, build-phase
template, and merge logic. Needs careful testing.

**Recommendation:** Start with large tasks only (>3 files modified). Keep
current approach for small tasks.

---

## 3. Use `PostCompact` hook for state refresh

**Current:** If the orchestrator's context is compacted (unlikely given how light
it stays, but possible in very long sessions), there's no recovery mechanism.

**Opportunity:** The `PostCompact` hook fires after compaction and receives
`compact_summary`. We can use this to re-inject critical state.

**What changes:**
- Add a `PostCompact` hook that re-reads `state.md` and the active plan summary
- Inject this as a system-level reminder after any compaction event
- Ensures the orchestrator never loses track of current phase/progress

**Principles honored:** 1 (orchestrator recovers from compaction gracefully),
2 (state refresh from source of truth, not compressed memory)

**Risk:** Minimal. This is purely additive safety.

**Effort:** Low -- one hook script + hook registration

---

## 4. ~~Leverage Adaptive Reasoning effort levels~~ IMPLEMENTED

**Status:** Implemented 2026-04-09.

**What was done:**
- Both `devorch-builder.md` and `devorch-builder-deep.md` set `effort: high` and `model: opus`
- All tasks run at opus/high — no per-task model or effort overrides
- `build.md` and `talk.md` always dispatch `devorch-builder-deep` (opus/high) for every task
- Per-task `**Model**` and `**Effort**` fields exist in plan format but are fixed to opus/high
- `init-phase.ts` parses Model/Effort from tasks (kept for structural compatibility)
- `validate-plan.ts` warns on unrecognized Model/Effort values
- Explore agents and verification agents inherit opus from session (no model override)

**Mapping (actual):**
- **All builder agents:** `effort: high`, `model: opus` — always `devorch-builder-deep`
- **Explore/verification agents:** opus (inherited from session, no explicit override)

**Not yet implemented (deferred):**
- Orchestrator effort level (would require the orchestrator skill itself to set effort — currently inherits session default)
- Adversarial reviewer effort (Explore agents don't have a per-invocation effort parameter yet — pending Claude Code feature)

---

## 5. Publish `check-project.ts` as a standalone plugin

**Current:** `check-project.ts` is devorch-internal. It auto-detects and runs
lint/typecheck/build/test in parallel for any project.

**Opportunity:** The Plugin Marketplace (~834 plugins, official Anthropic
marketplaces) would give this utility massive reach. It's useful even without
devorch -- any Claude Code user benefits from automatic project validation.

**What changes:**
- Extract `check-project.ts` + dependencies into a standalone plugin package
- Publish to Plugin Marketplace with appropriate metadata
- devorch continues using it, now as a plugin dependency instead of bundled script

**Principles honored:** 3 (scripts over LLM computation -- now available to everyone)

**Risk:** Maintenance burden of a public package. Versioning coordination.

**Effort:** Medium -- packaging, documentation, marketplace submission

---

## 6. Use native auto-memory for conventions persistence

**Current:** `map-conventions.ts` generates `.devorch/CONVENTIONS.md` and it's
passed explicitly to builders via `init-phase.ts`.

**Opportunity:** Native auto-memory persists insights across sessions and is
shared between worktrees of the same repo. Conventions could live in auto-memory
instead of a file that needs explicit loading.

**Evaluation -- DO NOT DO THIS.**

This violates Principle 6 (code is source of truth) and Principle 3 (compute
outside the LLM). `map-conventions.ts` deterministically analyzes actual code.
Auto-memory stores LLM-generated summaries that may become stale. The current
approach is superior.

**However:** Auto-memory could complement conventions with soft preferences that
aren't derivable from code (e.g., "the team prefers X pattern over Y for new code").
These are currently captured in CLAUDE.md but could be auto-detected from user
feedback patterns.

---

## 7. Use Claude Agent SDK for programmatic orchestration

**Current:** Orchestration is driven by markdown prompt files (commands/*.md)
that instruct the LLM to call tools in specific patterns.

**Opportunity:** The Claude Agent SDK (Python/TypeScript) provides the same tools,
agent loop, and context management programmatically. The orchestration logic could
be code instead of prompts.

**Evaluation -- DEFER (reassessed 2026-03-15).**

The Agent SDK spawns the Claude Code CLI binary as a subprocess (bundled inside
the npm/pip package) and communicates via JSON-lines over stdin/stdout. This
means it inherits CLI authentication, including Max subscription for personal
use (confirmed by Anthropic -- issue #559 closed as resolved).

**Billing: NOT a blocker.** Max subscription works for personal/local use.
Anthropic only prohibits OAuth tokens in commercial third-party products.

**What the SDK would add:**
- Hooks as TypeScript callbacks (faster than shell command hooks)
- Programmatic subagent definitions (not just filesystem-based)
- `max_turns` to prevent builder infinite loops
- `max_budget_usd` for cost guardrails
- Structured output with schema validation and retries
- Custom tools in-process via `createSdkMcpServer`
- Streaming granular via `StreamEvent`

**What the SDK loses vs current approach:**
- No auto-memory (but devorch has state.md, so acceptable)
- No CLAUDE.md auto-discovery (needs manual `settingSources: ["project"]`)
- No skills auto-discovery (needs explicit config)
- `allowed-tools` frontmatter in SKILL.md doesn't work
- **Transparency trade-off:** Markdown prompts are readable/editable by anyone;
  TypeScript orchestration is more opaque but more predictable

**When to consider:** When prompt-based orchestration hits reliability issues
(agents not following instructions consistently). The SDK provides code-level
control that eliminates prompt interpretation ambiguity. Also valuable if
devorch becomes a distributable tool where programmatic control matters more
than editability.

**Effort:** High -- fundamental architecture change

---

## 8. Sparse worktrees for monorepo performance

**Current:** `setup-worktree.ts` creates full worktrees. For large monorepos,
this means checking out the entire repo even when the plan only touches a subset.

**Opportunity:** `worktree.sparsePaths` (v2.1.76) enables git sparse-checkout
in worktrees, checking out only specified directories.

**What changes:**
- `setup-worktree.ts` accepts a `--sparse-paths` parameter
- During plan creation, `talk.md` derives sparse paths from the plan's
  `<relevant-files>` and `<new-files>` sections
- Worktrees only contain the directories needed for the plan

**Principles honored:** 3 (less I/O, faster setup), 4 (plan structure enables
optimization)

**Risk:** Missing files that weren't anticipated in the plan. Mitigation: include
common shared directories (types/, utils/, config/) by default.

**Effort:** Low-Medium -- extend `setup-worktree.ts`, add sparse path derivation

---

## 9. HTTP hooks for external integrations

**Current:** devorch is self-contained. No external notifications or integrations.

**Opportunity:** HTTP hooks (v2.1.63) can POST JSON to external services on
devorch events. Combined with `TaskCompleted` hooks, this enables:

- Slack notifications when phases complete
- Dashboard updates for long-running builds
- CI/CD triggers on successful final verification

**What changes:** Optional hook configuration in devorch settings. Not core
to orchestration, but valuable for team workflows.

**Principles honored:** None violated. Purely additive.

**Effort:** Low -- hook configuration, no core logic changes

---

## Priority Order

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| ~~1~~ | ~~Adaptive Reasoning effort levels (#4)~~ | ~~Low~~ | ~~Done 2026-04-09~~ |
| 2 | PostCompact state refresh hook (#3) | Low | Safety net for long sessions |
| 3 | Sparse worktrees for monorepos (#8) | Low-Med | Faster setup for large repos |
| 4 | Agent Teams for exploration (#1) | Medium | Simpler exploration code |
| 5 | Builder worktree isolation (#2) | Med-High | Stronger isolation guarantee |
| 6 | check-project plugin (#5) | Medium | Community value + maintenance |
| 7 | HTTP hooks for notifications (#9) | Low | Team workflow improvement |
| 8 | Agent SDK orchestration (#7) | High | Only if reliability demands it |
| -- | Auto-memory for conventions (#6) | -- | Rejected (violates principles) |
