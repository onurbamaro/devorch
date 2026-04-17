# V3 `/devorch` Command — Dry-Run Test Plan

Static walkthrough of `commands/devorch.md` (335 lines, unified v3 entry) against the
actual scripts under `scripts/`, the referenced agents under `agents/`, and the
spec in `.devorch/plans/devorch-v3-redesign.md`. No execution. Goal: surface
what a user would hit on first run.

Scope of verification:
- Every `bun $CLAUDE_HOME/devorch-scripts/<script>.ts` reference mapped to a file.
- Every flag passed cross-checked with `parseArgs` / positional parsing in each script.
- Every subagent reference (`Explore`, `devorch-builder-deep`) resolved against `agents/` or CC natives.
- Init-phase JSON shape compared against what `d.md` reads.
- Merge flow script existence and arg shape.
- File reads (`profile.yml`, `standards-silenced.md`) for absence handling.

---

## Walkthroughs

### Example 1 — Quick: `/devorch "fix typo 'recieve' to 'receive' in api/orders.ts"`

Expected tool-call order the orchestrator would make:

1. (implicit) `--resume` not present → skip Step 0.
2. Step 1 — load minimal context:
   - `Bash`: `bun $CLAUDE_HOME/devorch-scripts/map-project.ts --compact` — exists, accepts `--compact` (positional/flag parser in `scripts/map-project.ts:13-24`). Returns ~80 lines of tech stack + folder structure to inline context.
   - `Read`: `.devorch/CONVENTIONS.md` if present. If missing, fine — later steps don't hard-require it.
   - `Read`: `.devorch/profile.yml` if present. See Issue #4 — no explicit `if missing → default` instruction.
   - Stale-cache cleanup: delete any `.devorch/explore-cache-*.md` older than 7 days. d.md gives no concrete command; orchestrator would have to `Bash find .devorch -name 'explore-cache-*.md' -mtime +7 -delete` or use a `Glob` + per-file `mtime` check. Minor gap (Issue #5).
3. Step 2 — triage (internal thinking): `$ARGUMENTS` has a specific file path, an explicit verb (`fix`), and unambiguous scope. Classify as `quick`. Output the single line `Classification: quick — typo fix in a single identified file.`
4. Step 3 — guardian pass (internal thinking): typo fix, no adjacent code change, no security/performance surface. No critical heads-up, no bifurcation → silence. OK.
5. Step 4 — route to Q1.
6. Q1 — heads-up gate: no heads-up → proceed silently.
7. Q2 — `Edit` (or `Grep` then `Edit`) on `api/orders.ts` replacing `recieve` → `receive`. If the typo occurs multiple times, use `replace_all: true`.
8. Q3 — post-edit lint hook fires automatically via `PostToolUse`. Note: the hook is declared inside `agents/devorch-builder-deep.md:7-13`, which only applies inside that sub-agent's session. For a `quick` flow the orchestrator runs in the parent session — the hook fires only if the user's `~/.claude/settings.json` has a `PostToolUse` matcher for `Write|Edit` pointing to `post-edit-lint.ts`. d.md asserts this as "always active across modes" (line 332) but this depends on harness config not shipped in the repo. See Issue #6.
9. Q4 — `Bash`: `git add api/orders.ts && git commit -m "fix(api): correct typo receive"`.
10. Q5 — one-line report. Stop.

Result: flows cleanly. Only friction is the stale-cache deletion step being under-specified and the post-edit lint hook being an assumption about harness config. No script call would error.

### Example 2 — Scoped: `/devorch "add POST /api/orders/bulk endpoint with rate limit"`

Expected tool-call order:

1. (implicit) `--resume` absent → skip Step 0.
2. Step 1 — same as Example 1: `Bash map-project.ts --compact`, `Read CONVENTIONS.md`, `Read profile.yml`, stale-cache cleanup.
3. Step 2 — triage (internal thinking): new endpoint in existing module + legitimate trade-offs (rate-limit middleware vs per-route, token-bucket vs sliding-window, per-user vs per-IP, in-memory vs Redis). One module. Classify as `scoped`. Line: `Classification: scoped — new endpoint with clear module scope and legitimate trade-offs on rate-limit backend.`
4. Step 3 — guardian (internal thinking), checklist hits:
   - Heads-ups: input validation on body, idempotency key for POST bulk, auth on the route, cross-tenant isolation on bulk writes (never trust client's tenant id).
   - Bifurcations: rate-limit scope (global middleware vs route-specific), storage backend (in-memory process-local vs Redis), per-IP vs per-auth-token.
5. Step 4 — route to S1.
6. S1 — derive `<name>` e.g. `post-orders-bulk-rate-limit`. Launch 1 `Task` call with `subagent_type="Explore"`, thoroughness medium. `Explore` is a Claude Code native subagent (not in `agents/`) — OK. Wait for return.
7. S2 — enumerate edge cases into 3 buckets (resolved-by-convention / heads-up / bifurcation).
8. S3 — emit transparency block (plain markdown, no box-drawing), then one `AskUserQuestion` with options `Nenhum` / `Todos` / `Números`.
9. S4 — `--worktree` not set → `projectRoot = <cwd>`. No `setup-worktree.ts` call.
10. S5 — `Edit` / `Write` on the relevant module files (e.g. `api/orders.ts` for the route, a middleware file for rate-limit). Post-edit lint hook — same caveat as Example 1.
11. S6 — `Bash`: `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <cwd> --quick`. `check-project.ts` accepts positional project dir and `--quick` flag (scripts/check-project.ts:16-27). Returns `{lint: "skip", typecheck: "pass"|"fail:...", build: "pass"|"...", test: "skip"}`. On fail, one retry then report+stop.
12. S7 — `Bash git add <files> && git commit -m "feat(api): bulk orders endpoint with rate limit"`.
13. S8 — concise report.

Result: clean flow. No script calls error. Guardian pass is most likely to surface a real bifurcation (Redis vs in-memory) that the gate resolves via follow-up `AskUserQuestion`. If the user chose `--worktree`, S4 would additionally call `setup-worktree.ts --name post-orders-bulk-rate-limit` and copy CONVENTIONS.md into the new `.worktrees/post-orders-bulk-rate-limit/.devorch/`.

### Example 3 — Full: `/devorch "add real-time order dashboard with delta sync to multi-screen clients"`

Expected tool-call order (the longest flow):

1. Step 0 skipped.
2. Step 1 — same as Example 1: `Bash map-project.ts --compact`, `Read CONVENTIONS.md`, `Read profile.yml`, stale-cache cleanup.
3. Step 2 — triage (internal thinking): multi-module (server push + client rendering + persistence), realtime, new abstraction, term "delta sync" almost certainly without precedent in repo → `full`. Line: `Classification: full — realtime dashboard with delta sync, cross-cutting across API + client + storage.`
4. Step 3 — guardian (internal thinking): likely heads-ups on realtime strategy (WebSocket vs SSE vs polling), pagination + backpressure, cache tiers, observability (realtime failures are silent), auth on subscription. Bifurcations: push vs pull delta, CRDT vs operation-log, fan-out strategy (server-side vs edge).
5. Step 4 — route to F1.
6. F1 — worktree + plan scaffold:
   - Derive `<name>` e.g. `realtime-order-dashboard`.
   - `Bash git branch --show-current` → record `originalBranch` (e.g. `master`).
   - CONVENTIONS check: if missing, `Bash bun $CLAUDE_HOME/devorch-scripts/map-conventions.ts <mainRoot>` (accepts positional `cwd` — scripts/map-conventions.ts:14) and write to `.devorch/CONVENTIONS.md`. Then `Bash check-conventions-staleness.ts --update`. If present, run `Bash check-conventions-staleness.ts` first; if stale, regenerate then `--update`. Both scripts exist and accept the flags shown (scripts/check-conventions-staleness.ts:16, 19).
   - `Bash bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name realtime-order-dashboard` → parseArgs accepts `--name` required (scripts/setup-worktree.ts:15-21). Returns `{worktreePath: ".worktrees/realtime-order-dashboard", branch: "devorch/realtime-order-dashboard", devorch: false|true, [warnings], [satellites]}`. d.md reads `worktreePath` only (line 193).
   - `Bash cp .devorch/CONVENTIONS.md <projectRoot>/.devorch/CONVENTIONS.md` (conceptually — may be done via Read+Write or `cp`).
7. F2 — deep explore + guardian + gate:
   - 3 parallel `Task` calls with `subagent_type="Explore"`, thoroughness "very thorough", distinct focuses (architecture, risks/edges, existing patterns).
   - After all return, `Write <mainRoot>/.devorch/explore-cache-realtime-order-dashboard.md`. Note: the cache file goes to `<mainRoot>`, but all scripts that read cache later use `--cache-root <mainRoot> --cache-name <name>` — init-phase and manage-cache both respect this (scripts/init-phase.ts:42-47, scripts/manage-cache.ts:17-31).
   - Re-run guardian internally, emit transparency block + `AskUserQuestion` gate.
   - Draft plan per Plan Format "specified in `commands/talk.md`" (F2.4). d.md does not restate the plan format inline — cross-reference dependency. See Issue #1.
   - `Write <projectRoot>/.devorch/plans/realtime-order-dashboard.md` with the plan.
   - `Bash bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <path>` — script exists, accepts `--plan` required (scripts/validate-plan.ts:10-12). Returns `{result: "continue"|"block", reason?: "..."}`.
   - `Bash git -C <projectRoot> add .devorch/plans/<name>.md .devorch/CONVENTIONS.md && git -C <projectRoot> commit -m "chore(devorch): plan — realtime-order-dashboard"`. Also `git add .devorch/explore-cache-*.md && git commit -m "chore(devorch): add worktree for realtime-order-dashboard"` in mainRoot.
8. F3 phase loop (say the plan has 3 phases), per phase N:
   - F3a: `Bash bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N --cache-root <mainRoot> --cache-name realtime-order-dashboard` — all four flags match `parseArgs` in scripts/init-phase.ts:42-47. Returned JSON includes `waves`, `tasks`, `conventions`, `conventionSectionsByTask`, `cacheByTask`, `specsByTask`, `codeStructureByTask`, `exemplarsByTask`, `nonGoalsByTask`, `exploreQueries`, `cacheCoversPhase`, `uncoveredFiles`, `sliceWarnings`, plus either `content` or `contentFile` (threshold 50000 chars — scripts/init-phase.ts:15, 787).
   - F3b: filter size gate — d.md tells the orchestrator to inspect "combined injection size … <3K or >30K". init-phase EMITS `sliceWarnings` (scripts/init-phase.ts:657-682, exposed at 808) that already does this computation against the same 3000/30000 thresholds. d.md does NOT reference `sliceWarnings` by name — it tells the model to recompute the gate. See Issue #2.
   - F3c: dispatch builders — single message with parallel `Task` calls, `subagent_type="devorch-builder-deep"` (agent exists at `agents/devorch-builder-deep.md`, `model: opus`, `effort: high`). Section order listed (Conventions → Code Structure → Exemplars → Spec Contracts → Non-goals → cache) matches build.md § 2c verbatim (commands/build.md:97). After return: extract `## Build Report` per task, `TaskUpdate` completed tasks. On failure → per-task retry (max 3) with error context. Retry template "same template as commands/build.md § 2c" — resolves to build.md:133-150 when talk/build are co-installed. Same dependency as Issue #1.
   - F3d (only if totalPhases > 1): `Bash bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`.
   - F3e: `Bash bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan <planPath> --phase N --status "ready for phase N+1" --summary "<concise>"` — parseArgs requires these four, optional `--satellites` (scripts/phase-summary.ts:14-20). d.md does not pass `--satellites` even when satellites exist — see Issue #7. Script returns `{message, phase, goal, stateFile, planTitle}`. d.md uses `message` for the commit.
   - `Bash bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000 --root <mainRoot> --cache-name realtime-order-dashboard` — all flags match (scripts/manage-cache.ts:17-22).
9. F4 — categorized adversarial review:
   - `Bash git -C <projectRoot> diff --name-only <originalBranch>...HEAD` — three-dot gives changes on worktree branch since divergence. Correct.
   - `Grep` for TODO|FIXME|HACK|XXX across changed files (residual scan).
   - 4 parallel `Task` calls with `subagent_type="Explore"`: `security`, `performance`, `completeness`, `flags`. d.md uses 4 fixed reviewers; build.md § 3b scales by task count (2-4) and uses different reviewer names (`quality-reviewer`, `contracts-reviewer`). Intentional simplification but divergent mental model — see Issue #8.
   - `flags` reviewer writes `<mainRoot>/.devorch/flags-realtime-order-dashboard.md` per `docs/FLAGS.md`.
10. F5 — apply review fixes. Tier classification (trivial / fix-level / talk-level) matches build.md § 3c. Skip entirely if all reviewers report zero findings.
11. F6 — verdict report (pt-BR headings).
12. F7 — merge flow:
    - d.md says "call `/devorch:worktrees merge <name>` conceptually" (line 277) — that command (`commands/worktrees.md`) is interactive and does NOT accept `<name>` as an argument-hint. The word "conceptually" signals that d.md invokes `merge-worktree.ts` directly below.
    - `Bash bun $CLAUDE_HOME/devorch-scripts/merge-worktree.ts --worktree-path <projectRoot> --main-root <mainRoot> --original-branch <originalBranch> --branch-name devorch/realtime-order-dashboard` — all four required flags match parseArgs (scripts/merge-worktree.ts:26-33).
    - d.md does NOT pass `--satellites '<json>'` even though `merge-worktree.ts` supports it (optional, so not fatal). Multi-repo merge from `/devorch` full-mode silently loses satellite support — see Issue #9.
    - Parse `status`: `success`/`conflict`/`stash-conflict`/`error`. Matches MergeResult (scripts/merge-worktree.ts:50-63).
    - `selfBuildNeeded` + `<mainRoot>/install.ts` exists → `Bash bun run install`. Script already does this internally (scripts/merge-worktree.ts:482-493) — running it again in the orchestrator is redundant but idempotent. See Issue #10.
    - Archive plan: d.md line 292 hedges "runs from `<mainRoot>` against the archived copy if the script copies it out of the worktree pre-removal; otherwise skip if the merge script already archived." `merge-worktree.ts:216-246` already runs `archive-plan.ts --target-root <mainRoot>` on the worktree's plan before removing the worktree. So the fallback almost never triggers. See Issue #11.
13. F8 — feedback: if `<mainRoot>/.devorch/feedback.md` gained entries, append reminder.

Result: gets through with warnings. Biggest unknowns are (a) whether the orchestrator picks up the `sliceWarnings` field or laboriously recomputes (Issue #2), (b) satellite repos are silently unsupported (Issue #9), and (c) the plan-format cross-reference only holds as long as `talk.md` ships alongside `d.md` (Issue #1).

---

## Issues

Each issue is classified as **blocker** (users hit a broken reference / script error), **gap** (works but with manual effort or missed feature), or **nit** (cosmetic / clarification).

### Issue 1 — Plan format is only referenced, not embedded (gap)
- File: `commands/devorch.md:201`
- Quote: "Draft the plan following the Plan Format specified in `commands/talk.md`"
- Problem: d.md positions itself as unified v3 entry but depends on talk.md being present and read for the plan schema (Format: description, objective, classification, decisions, problem-statement, solution-approach, relevant-files, phases with `<spec>`, `<tasks>`, `<execution>`, `<criteria>`, `<handoff>`). The list in F2.4 helps, but the exact XML-ish structure with tag semantics is only in talk.md. Same issue at F3c referencing `commands/build.md § 2c` for the failure template.
- Fix: either inline the plan schema in d.md, or create a shared `docs/PLAN-FORMAT.md` both reference.

### Issue 2 — `sliceWarnings` emitted by init-phase but not consumed by d.md (gap)
- File: `commands/devorch.md:213-214`
- Quote: "For each task, inspect the combined injection size (conventions slice + code structure + specs + cache slice). If any task comes back with <3K or >30K tokens, pause and show the user"
- Problem: `scripts/init-phase.ts:657-682` computes exactly this and emits `sliceWarnings: Array<{taskId, tokens, direction: "under"|"over"}>` in the JSON output. d.md tells the orchestrator to recompute manually, wasting effort and risking mismatch with the script's authoritative thresholds (3000/30000).
- Fix: change F3b to: "Read `sliceWarnings` from init-phase output. If non-empty, pause and show the user which task, which direction, and the token count. Offer continue/split/re-curate."

### Issue 3 — `list-worktrees.ts` JSON shape mostly matches Step 0 expectations (pass with edge)
- File: `commands/devorch.md:21-24`
- Check: `list-worktrees.ts` outputs `{worktrees: [{name, path, branch, planTitle, status, lastPhase, totalPhases, valid, satellites}], count, mainBranch}` (scripts/list-worktrees.ts:179-192). d.md reads `count` and iterates worktrees for `name + plan title`. All the referenced fields exist.
- Edge: d.md step 0.3 says to set `planPath` to "the first `.md` under `<projectRoot>/.devorch/plans/` (excluding `archive/`)". `list-worktrees.ts` already does this internally (scripts/list-worktrees.ts:159-164) but does NOT expose `planPath` in its output. d.md must redo the readdir manually. Minor duplication. See also Issue #12.

### Issue 4 — No explicit absence handling for `profile.yml` / `standards-silenced.md` (nit)
- File: `commands/devorch.md:28, 69`
- Problem: d.md says "Read `.devorch/profile.yml` if it exists" (28) and "consult `.devorch/standards-silenced.md` if present" (69). The word "if" implies a branch but no explicit `<profile>` default is specified in d.md when both files are missing. `docs/PROFILE.md:84-95` defines the default (`security > performance > dx > cost`) and says "No file at any level means defaults apply" — but d.md does not cross-reference this.
- Fix: in Step 1, add one line: "If `profile.yml` is missing at both `~/.devorch/` and `<mainRoot>/.devorch/`, set `<profile>` to the defaults in `docs/PROFILE.md` § Defaults when absent."

### Issue 5 — Stale cache cleanup lacks a concrete command (nit)
- File: `commands/devorch.md:30`
- Quote: "Also clean up stale cache: delete any `.devorch/explore-cache-*.md` files older than 7 days."
- Problem: no script exists for this, and d.md does not tell the orchestrator which tool to use. The orchestrator will pick `Bash find -mtime +7 -delete` or similar. Works but is fragile (WSL permissions, portable find flags, etc.).
- Fix: either add a helper script `cleanup-stale-cache.ts` or specify the exact Bash command in d.md.

### Issue 6 — Post-edit lint hook is only declared on `devorch-builder-deep`, not the parent session (gap)
- File: `commands/devorch.md:94, 168, 332`
- Quote: "The post-edit lint hook fires automatically via `PostToolUse`" (Q3) and "Post-edit lint hook is always active across modes" (Rules).
- Problem: hook config lives in `agents/devorch-builder-deep.md:7-13`, which only applies inside that sub-agent's session. In `quick` and `scoped` modes, edits happen directly in the orchestrator context, where the hook fires only if the user's `~/.claude/settings.json` has an equivalent `PostToolUse` matcher. Nothing in the repo guarantees that.
- Fix: either ship a project-level `settings.json` with a `PostToolUse` hook, or update d.md Q3/S5 to say "run lint manually after edit" instead of relying on an implicit hook.

### Issue 7 — `phase-summary.ts --satellites` not passed when satellites exist (gap)
- File: `commands/devorch.md:225`
- Problem: `phase-summary.ts` accepts optional `--satellites '<json>'` (scripts/phase-summary.ts:19) used to propagate satellite status into the state file. d.md's F3e invocation omits this flag even in multi-repo plans.
- Fix: detect non-empty `satellites` from init-phase output and pass `--satellites '<json>'` with per-repo status (as build.md § 2e already does, commands/build.md:198).

### Issue 8 — Fixed 4 reviewers vs build.md's scaled 2-4 reviewers (nit)
- File: `commands/devorch.md:233-238`
- Problem: d.md F4 always runs 4 reviewers (`security`, `performance`, `completeness`, `flags`). build.md § 3b scales by task count and uses different reviewer names (`quality-reviewer`, `contracts-reviewer`). Not a failure, but divergence from the existing v2 flow means the mental model for reviewers shifts between `/devorch` and `/devorch:build`.
- Fix: acceptable as intentional simplification. Consider adding a note: "v3 uses 4 fixed reviewers regardless of size — different from v2 scaling."

### Issue 9 — Multi-repo (satellites) support missing in F1 and F7 (gap)
- File: `commands/devorch.md:193, 280-285`
- Problem: `setup-worktree.ts --secondary '<json>'` and `merge-worktree.ts --satellites '<json>'` both accept satellite specs, but d.md never constructs or passes them. If the plan includes `<secondary-repos>` (validated by `validate-plan.ts` / parsed by `extractSecondaryRepos`), init-phase will FAIL at startup with "Satellite worktree for 'X' not found at ..." (scripts/init-phase.ts:416-423) because F1 never created them.
- Fix: in F1, after parsing the drafted plan, detect `<secondary-repos>`. If present, re-run `setup-worktree.ts` with `--add-secondary '<json>'` or include `--secondary` on the initial call. In F7, build the `satellites` JSON from the plan and pass `--satellites` to `merge-worktree.ts`.

### Issue 10 — Redundant `bun run install` after merge success (nit)
- File: `commands/devorch.md:288`
- Problem: d.md says "If `selfBuildNeeded` and `<mainRoot>/install.ts` exists, run `bun run install` in `<mainRoot>`." But `merge-worktree.ts:482-493` already runs `bun run install` internally before reporting `selfBuildNeeded`. Running it again is idempotent but adds latency and noise.
- Fix: change the sentence to: "If `selfBuildNeeded == true`, note 'install was auto-run by merge script' and skip."

### Issue 11 — Archive plan fallback in F7 is unreachable (nit)
- File: `commands/devorch.md:292`
- Problem: d.md hedges with "runs from `<mainRoot>` against the archived copy if the script copies it out of the worktree pre-removal; otherwise skip if the merge script already archived." In practice, `merge-worktree.ts:216-246` ALWAYS runs `archive-plan.ts --target-root <mainRoot>` on the worktree's plan before removing the worktree. The "otherwise" branch never fires.
- Fix: simplify to: "Plan archival already done inside `merge-worktree.ts`. Skip."

### Issue 12 — Step 0.3 single-worktree resume duplicates list-worktrees' plan-file scan (nit)
- File: `commands/devorch.md:23`
- Problem: d.md tells the orchestrator to readdir the plans folder itself, but `list-worktrees.ts` already does this internally (for `planTitle`) — it just doesn't surface `planPath`.
- Fix: extend `list-worktrees.ts` output to include `planPath` for each worktree. Simpler for downstream consumers.

### Issue 13 — `cache-name` inconsistency with v2 build.md derivation (gap)
- File: `commands/devorch.md:211`
- Quote: F3a uses `--cache-name <name>`, where `<name>` is the kebab derived in F1.
- Problem: build.md § 0 has a 3-fallback `cacheName` derivation (worktree name → plan filename → plan title kebab) that's more robust. d.md always uses the F1-derived name. If F1 runs and the worktree is later resumed via `--resume`, the `<name>` variable is implicit in the worktree folder name — OK, but not documented. When `--resume` jumps to F3 directly (step 0.3), d.md says to set `projectRoot` but does not re-derive `<name>` or `cacheName`. Likely bug on resume.
- Fix: in Step 0.3/0.4, explicitly set `<name>` = basename of `<projectRoot>` and `cacheName = <name>`.

### Issue 14 — F3 phase loop start requires `mainRoot`/`originalBranch`/`<name>` on `--resume` (gap)
- File: `commands/devorch.md:23-24, 206`
- Problem: Resume path jumps directly to F3, but F3 uses `<mainRoot>`, `<name>`, and (for F7) `<originalBranch>`. Step 0 does not re-establish these. `mainRoot` can be inferred (cwd), `<name>` from the worktree folder name, but `originalBranch` is only recorded in F1 and is lost on resume.
- Fix: on resume, record `mainRoot = <cwd>`, `<name> = basename(projectRoot)`, and detect `originalBranch` via `git -C <mainRoot> symbolic-ref refs/remotes/origin/HEAD` or `getMainBranch` lib. Persist these to a lightweight session header.

### Issue 15 — `--worktree` accepted only for scoped mode, but documented in top-level argument-hint (nit)
- File: `commands/devorch.md:3, 13, 158`
- Problem: `argument-hint` advertises `[--quick|--full|--resume|--worktree]` as alternatives, suggesting any can be combined with a description. `--worktree` is only respected inside `scoped` mode (S4). If a user types `/devorch --quick --worktree "..."`, d.md does not specify behavior.
- Fix: clarify: "`--worktree` is only valid when classification is `scoped`. Ignored with `--quick` / `--full`." Or allow `--quick` to skip worktree explicitly for consistency.

### Issue 16 — Empty `$ARGUMENTS` without `--resume` rule is correct but unreachable check for forced flags (nit)
- File: `commands/devorch.md:16`
- Quote: "If `$ARGUMENTS` is empty and `--resume` is not set, stop and ask the user."
- Problem: if the user runs `/devorch --quick` (with a flag but no description), the check does not stop because `$ARGUMENTS` literally contains `--quick`. The triage / guardian will then have nothing to classify.
- Fix: strip known flags before the empty check: "If after removing flags `$ARGUMENTS` is empty and `--resume` is not set, stop and ask."

### Issue 17 — F1 `git branch --show-current` before worktree creation (nit)
- File: `commands/devorch.md:191`
- Check: F1 records `originalBranch = git branch --show-current` in mainRoot BEFORE `setup-worktree.ts` runs. That is correct; setup-worktree leaves mainRoot's HEAD untouched (it uses `git worktree add -b`). OK.

---

## Passes

Short list of non-obvious things that check out correctly:

- Every `bun $CLAUDE_HOME/devorch-scripts/<script>.ts` reference in d.md maps to a real file under `scripts/`: `map-project.ts`, `map-conventions.ts`, `check-conventions-staleness.ts`, `setup-worktree.ts`, `list-worktrees.ts`, `validate-plan.ts`, `init-phase.ts`, `check-project.ts`, `phase-summary.ts`, `manage-cache.ts`, `merge-worktree.ts`, `archive-plan.ts`. No dangling script references.
- `init-phase.ts` exposes ALL the fields d.md consumes (directly or implicitly): `contentFile`, `content`, `waves`, `tasks`, `conventionSectionsByTask`, `cacheByTask`, `specsByTask`, `codeStructureByTask`, `exemplarsByTask`, `nonGoalsByTask`, `exploreQueries`, `cacheCoversPhase`, `uncoveredFiles`, `sliceWarnings`, `totalPhases`. Even the field d.md describes only in prose (slice size gate) is already materialized — just not referenced by name (Issue #2).
- `merge-worktree.ts` parseArgs defines exactly the flags d.md passes in F7: `--worktree-path`, `--main-root`, `--original-branch`, `--branch-name` (all required). JSON shape (`status`, `mergedRepos`, `filesChanged`, `selfBuildNeeded`, `migrationJournalFixed`, `conflictRepo`, `conflictFiles`) matches the routing logic d.md describes.
- `check-project.ts --quick` exists and behaves as documented: skips lint+test, runs build+typecheck only (scripts/check-project.ts:170, 177-180).
- `devorch-builder-deep` agent exists at `agents/devorch-builder-deep.md` with `model: opus` and `effort: high`, matching d.md's F3c assertion.
- `Explore` subagent referenced in S1/F2/F4 is a Claude Code native (no file in `agents/` needed, consistent with how `talk.md`/`build.md` reference it).
- F2's plan draft includes `<phaseN>` sections with required tags (`<spec>`, `<tasks>`, `<execution>`, `<criteria>`, `<handoff>`) — `validate-plan.ts` accepts this shape and `init-phase.ts` parses it.
- The cache invalidate/trim sequence (F3e) correctly chains `--action invalidate,trim` with `--max-lines 3000` and `--root <mainRoot>`, matching `manage-cache.ts`'s comma-separated action parsing (scripts/manage-cache.ts:28).
- F4's diff command `git -C <projectRoot> diff --name-only <originalBranch>...HEAD` uses three-dot correctly (merge-base changes only), aligning with what reviewers need.
- Language policy (pt-BR user-facing, en-US code) stated in d.md:333 matches build.md/talk.md/worktrees.md wording verbatim — consistent across the command surface.
- Plain-markdown / no-box-drawing rule (d.md:334) aligns with the user's recorded feedback preference.
- Section order in builder prompts (F3c: Conventions → Code Structure → Exemplars → Spec Contracts → Non-goals → cache) is identical to build.md:97 — no drift.

---

## Summary counts

- Blockers: 0
- Gaps: 7 (#1, #2, #6, #7, #9, #13, #14)
- Nits: 9 (#4, #5, #8, #10, #11, #12, #15, #16, #17) — plus #3 which is a pass with an edge note, not counted as a nit.

### Priority — first item to fix

**Issue #9 (satellites support)** is the first to fix. Reason: it's the only item that produces a hard script error on first run for any plan that declares `<secondary-repos>`. `init-phase.ts:416-423` exits with `Satellite worktree for '<name>' not found` because F1 never creates the secondary worktrees. Every other gap degrades gracefully (manual recompute, redundant call, missing default) — #9 stops the run.

After that, Issue #2 (wire `sliceWarnings`) is the cheapest high-value fix: one sentence change in d.md F3b, zero script changes, and it removes an entire class of orchestrator re-computation drift.
