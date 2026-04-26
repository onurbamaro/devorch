# Plan: Improve devorch — cache split, plan semantic check, init-phase per-task curation

<description>
Refactor across three conceitos to root-cause 15 of 21 in-scope flow-friction items:
- Conceito A: split `.devorch/` into curated (tracked) vs ephemeral (always under `cache/`, gitignored).
- Conceito B: `init-phase.ts` becomes per-task gotcha curator with sanitization; slice gate accepts injection-token estimates from orchestrator.
- Conceito C: insert Step 7.5 (Plan semantic check) in commands/devorch.md to detect implicit shared touches before validate-plan.ts.
Plus minor fixes: Explore re-verification instruction, merge-worktree cwd resolution, validate-plan error messages, setup-worktree post-create assertions.
</description>

<objective>
After this plan: (1) `.devorch/cache/` holds all auto-regenerated artifacts (project-map.md, phase-context.md, state.json); rebases never collide on these paths. (2) `init-phase.ts` returns `gotchasByTask` per task, reads satellite GOTCHAS, sanitizes XML, accepts injection-token flag; slice gate fires only on real anomalies. (3) commands/devorch.md has Step 7.5 that catches implicit touches (barrels, hooks, migrations) before validate-plan.ts runs.
</objective>

<classification>
Type: refactor
Complexity: medium
Risk: medium
</classification>

<decisions>
- Cache directory name: `.devorch/cache/` → Plain "cache" subdirectory; user-confirmed default.
- Devorch self-repo gitignore: keep `.devorch/cache/` ignored; allow `.devorch/plans/`, `.devorch/GOTCHAS.md`, `.devorch/flags-*.md`, `.devorch/flow-issues-inbox/` to be tracked again (revert blanket ignore from commit 4cc3df7).
- state.md → state.json (structured). Reads via `safeReadJsonFile` helper if needed.
- Slice gate: orchestrator passes `--explore-injection-tokens '<json>'` flag to init-phase.ts. Alternative (post-assembly counting in orchestrator) was considered and rejected to keep mechanical work in scripts (Princípio 3).
- B and C are not bundled with A because A is foundation; doing them in 3 phases keeps each phase reviewable.
- Migration collision check (in Step 7.5) uses `git ls-tree origin/<mainBranch>:<satellite>/db/migrations/` — works without checkout.
</decisions>

<problem-statement>
Current implementation has three structural weaknesses driving most flow-friction:
1. `.devorch/` mixes ephemeral (regenerated) and curated (user content) files, causing rebase conflicts, atomic-abort guards needing fragile filter regexes, and list-worktrees inferring instead of reading state structurally.
2. `init-phase.ts` returns `gotchas` as a single phase-wide string read raw from primary's GOTCHAS.md only; no satellite handling, no XML sanitization, slice gate cannot account for orchestrator's downstream `## Explore Findings` injection (false positive on every task).
3. `validate-plan.ts` overlap check sees only file refs in task content (backtick paths); implicit touches (barrel index added when new module exposed, central hook file, next migration number) are invisible — surface as race conditions during build or merge.
</problem-statement>

<solution-approach>
Three phases, sequential (each phase passes per-phase check before next starts).

Phase 1 (Conceito A): mechanical relocation. New subdir `.devorch/cache/`. install.ts writes `.devorch/.gitignore` in target projects with `cache/` rule. init-phase.ts/phase-summary.ts/list-worktrees.ts updated to write/read from `cache/`. state.md → state.json (structured). setup-worktree.ts loses its dead `explore-cache.*\.md` filter.

Phase 2 (Conceito C + M.1): commands/devorch.md gains Step 7.5 (Plan semantic check) plus an Explore re-verification rule. Pure orchestrator-side change; no scripts touched.

Phase 3 (Conceito B + minor mechanical fixes): init-phase.ts refactored to gotchasByTask + sanitization + injection-token flag. commands/devorch.md Step 9c updated to consume the new shape and pass injection tokens. merge-worktree.ts gains deterministic mainRoot resolution. validate-plan.ts error messages include candidate spec names. setup-worktree.ts asserts post-create state.

Final: 4-reviewer adversarial pass (security/performance/completeness/flags) before merge.
</solution-approach>

<relevant-files>
- `.gitignore` — devorch repo own ignore rules
- `install.ts` — installs devorch into target projects; will write `.devorch/.gitignore` in each target
- `commands/devorch.md` — orchestrator instructions; gains Step 7.5 and Explore re-verification rule; Step 9c updated for new gotchasByTask
- `scripts/init-phase.ts` — biggest surface: cache paths in Phase 1, full refactor in Phase 3 (gotchasByTask + sanitization + injection-tokens flag)
- `scripts/phase-summary.ts` — writes state.json (was state.md) to cache
- `scripts/list-worktrees.ts` — reads state.json from cache
- `scripts/setup-worktree.ts` — Phase 1: drop dead filter regex; Phase 3: post-create assertions
- `scripts/merge-worktree.ts` — Phase 3: deterministic mainRoot resolution
- `scripts/validate-plan.ts` — Phase 3: improved spec-ref error messages
</relevant-files>

<global-invariants>
- All scripts must remain backwards-compatible during migration: if `.devorch/cache/state.json` does not exist but `.devorch/state.md` does, fall back to legacy read for the lifetime of one phase loop. New writes always go to cache/.
- Backwards-compat for `gotchasByTask`: orchestrators built against old `gotchas: string` schema must not break. Solution: emit BOTH `gotchas` (concatenated, for legacy) and `gotchasByTask` (new) until a future cleanup.
- No assistant-facing text should reference `.devorch/state.md`, `.devorch/project-map.md`, or `.devorch/.phase-context.md` after Phase 1 — replace with cache/-prefixed paths.
- Plain markdown only in user-facing output. No box-drawing.
</global-invariants>

<phase1 name="Cache split (Conceito A)">
<goal>Relocate all auto-regenerated `.devorch/*` artifacts to `.devorch/cache/`; install.ts manages target-project gitignore; clean up dead defenses.</goal>

<spec>
<behavior name="install-writes-cache-gitignore">
  <precondition>install.ts runs in a target project with or without an existing `.devorch/` directory.</precondition>
  <postcondition>After install, `.devorch/.gitignore` exists in target project with at least the line `cache/`. If the file already existed before install with different content, install does NOT overwrite (preserves user customization). If `.devorch/` did not exist, install creates it before writing the gitignore.</postcondition>
</behavior>

<behavior name="devorch-self-gitignore-revised">
  <precondition>devorch repo's own `/home/bruno/dev/devorch/.gitignore` currently has `.devorch/` blanket ignore on line 6.</precondition>
  <postcondition>That line is replaced with `.devorch/cache/`. Existing untracked files in `.devorch/plans/`, `.devorch/GOTCHAS.md`, `.devorch/feedback.md`, `.devorch/flow-issues-inbox/`, `.devorch/flags-*.md` become trackable again. No file is force-staged by this task; user controls when to track them.</postcondition>
</behavior>

<interface name="state-json-schema">
  <input>n/a — schema definition</input>
  <output>JSON file with shape `{status: string, lastPhase: number, lastPhaseSummary: string, updatedAt: string}`. `status` examples: "not started", "in progress", "ready for phase 2", "complete". `updatedAt` ISO 8601.</output>
</interface>

<behavior name="phase-summary-writes-state-json">
  <precondition>phase-summary.ts is invoked with `--phase N --status "..." --summary "..."` and writes phase state.</precondition>
  <postcondition>Writes `.devorch/cache/state.json` (creates parent dir if missing) with the schema in `state-json-schema`. Old `.devorch/state.md` writes are removed entirely. Output JSON `stateFile` field reflects the new path (`.devorch/cache/state.json`).</postcondition>
</behavior>

<behavior name="init-phase-reads-cache">
  <precondition>init-phase.ts runs against a project root.</precondition>
  <postcondition>Reads state from `.devorch/cache/state.json` if present (parses JSON). Falls back to `.devorch/state.md` via legacy regex parse only if state.json missing AND state.md present (backwards-compat). Writes `cache/project-map.md` (was `.devorch/project-map.md`) via map-project subprocess. Writes `cache/phase-context.md` (was `.devorch/.phase-context.md`) when content > 50000 chars threshold.</postcondition>
</behavior>

<behavior name="list-worktrees-reads-state-json">
  <precondition>list-worktrees.ts iterates over `.worktrees/*` entries.</precondition>
  <postcondition>For each worktree, reads `.devorch/cache/state.json` first (parses, returns `{status, lastPhase}`). Falls back to `.devorch/state.md` regex parse only if state.json missing. Returns same WorktreeInfo shape as before so consumers don't break.</postcondition>
</behavior>

<behavior name="setup-worktree-no-explore-cache-filter">
  <precondition>setup-worktree.ts at line 360 has filter `!/explore-cache.*\.md$/.test(f)` excluding files when copying user-changed `.devorch/` content.</precondition>
  <postcondition>That filter is removed; explore-cache files no longer exist (cache/ is gitignored, never appears in changed-files diff). The copy block becomes simpler: copies all changed+untracked `.devorch/` files except those under `cache/` (which won't be in the diff anyway).</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Gitignore + install.ts
- **ID**: cache-gitignore-install
- **Assigned To**: devorch-builder
- **Spec refs**: install-writes-cache-gitignore, devorch-self-gitignore-revised
- **Non-goals**: do not force-stage previously-untracked files; do not modify other rules in `.gitignore` beyond the `.devorch/` line
- Edit `.gitignore`: replace line 6 `.devorch/` with `.devorch/cache/`. Keep line 5 comment about project-map (or remove since it's now redundant — line 5 mentions only project-map.md but cache/ covers it).
- Edit `install.ts`: after creating `.devorch/` in target (or detecting it exists), write `.devorch/.gitignore` with `cache/\n` UNLESS the file already exists with different content. Print one-line install log.
- Add a self-test in install.ts (or just verify by running `bun install.ts` against a tmp dir) — not required to commit a test, just verify behavior.

#### 2. Relocate ephemeral artifacts to cache/
- **ID**: cache-relocate-artifacts
- **Assigned To**: devorch-builder
- **Spec refs**: state-json-schema, phase-summary-writes-state-json, init-phase-reads-cache, list-worktrees-reads-state-json
- **Non-goals**: do not change the WorktreeInfo or phase-summary output shape; do not break orchestrator instructions in commands/devorch.md
- Edit `phase-summary.ts:74,83-94,101`: change stateFile path to `.devorch/cache/state.json`, write JSON with the schema, ensure parent dir created. Remove all references to `.devorch/state.md` writes.
- Edit `init-phase.ts:105`: read `.devorch/cache/state.json` first (JSON parse), fall back to `.devorch/state.md` regex parse if state.json missing. Edit `:176` (project-map subprocess output): write to `cache/project-map.md`. Edit `:467` (phase-context fullContent): write to `cache/phase-context.md` (note: was `.phase-context.md` with leading dot — change to `phase-context.md` since cache/ already gitignored).
- Edit `list-worktrees.ts:175`: read `state.json` first, parse, return `{status, lastPhase}`. Fall back to legacy `state.md` regex parse if state.json missing.
- Verify backwards-compat: a worktree mid-build with old `state.md` continues to work until next phase-summary run. New writes always to cache/.

#### 3. Cleanup setup-worktree dead filter
- **ID**: cache-cleanup-setup-worktree
- **Assigned To**: devorch-builder
- **Spec refs**: setup-worktree-no-explore-cache-filter
- **Non-goals**: do not refactor unrelated parts of setup-worktree.ts
- Edit `setup-worktree.ts:360`: remove the `.filter((f) => !/explore-cache.*\.md$/.test(f))` chain. The line above's `[...changedFiles, ...untrackedFiles]` now passes through directly. If any other comments reference explore-cache, remove them.

</tasks>

<execution>
**Wave 1** (parallel): cache-gitignore-install, cache-relocate-artifacts, cache-cleanup-setup-worktree
</execution>

<criteria>
- [ ] `.gitignore` line 6 changed from `.devorch/` to `.devorch/cache/`
- [ ] `install.ts` writes `.devorch/.gitignore` containing `cache/` in target projects
- [ ] `phase-summary.ts` writes `.devorch/cache/state.json` with the schema
- [ ] `init-phase.ts` reads from `cache/state.json` and writes project-map.md / phase-context.md to `cache/`
- [ ] `list-worktrees.ts` reads from `cache/state.json` (with legacy fallback)
- [ ] `setup-worktree.ts` no longer has the dead `explore-cache.*\.md` filter
- [ ] Run `bun scripts/check-project.ts <projectRoot> --quick` passes
</criteria>

<handoff>
Phase 1 establishes `.devorch/cache/` as the canonical ephemeral location. Phase 2 may use the cache dir for its own outputs if needed (it doesn't currently). Phase 3 relies on init-phase.ts being clean before its bigger refactor.
</handoff>
</phase1>

<phase2 name="Plan semantic check + Explore re-verification (Conceito C + M.1)">
<goal>Add Step 7.5 (Plan semantic check) to commands/devorch.md and an Explore re-verification rule to prevent f2-overstates-zero-importers class of bugs.</goal>

<spec>
<behavior name="step-7-5-plan-semantic-check">
  <precondition>Step 7 has just written `<projectRoot>/.devorch/plans/<name>.md` and Step 8 (validate-plan.ts) is about to run.</precondition>
  <postcondition>commands/devorch.md gains a Step 7.5 between Step 7 and Step 8 with: (1) per-task implicit-touch inference (barrels, hooks, registries, migrations), (2) deterministic grep verification via Bash for each candidate, (3) silent re-wave with one-line log when overlap detected, (4) migration collision check via `git ls-tree origin/<mainBranch>:<satellite>/db/migrations/` for each repo with a migration task, auto-bump in plan if collision. The plan file is rewritten before Step 8 runs. Numbering of subsequent steps adjusts: current Step 8 stays Step 8 (validate-plan), Step 9 stays Step 9 (phase loop), etc. — only Step 7.5 is inserted, no renumber cascade.</postcondition>
</behavior>

<behavior name="explore-claim-reverification-rule">
  <precondition>Wave 1 or Wave 2 Explore agent reports a deterministic claim (e.g., "zero importers", "no usages found", "deprecated", "0 references") in its findings.</precondition>
  <postcondition>commands/devorch.md gains a Rule (added to "Rules" section near the bottom, OR as a sub-section under Step 5) stating: "When an Explore agent reports counts, absences, or presences as facts (zero importers, no usages, no callers, etc.), the orchestrator MUST verify with a deterministic grep before quoting the claim to a builder. If the grep contradicts the Explore claim, prefer the grep result and surface the discrepancy as a one-line note in the slice. Do not propagate uncertain claims as certainties."</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Add Step 7.5 + Explore re-verification rule to devorch.md
- **ID**: devorch-md-step-7-5-plus-explore-rule
- **Assigned To**: devorch-builder
- **Spec refs**: step-7-5-plan-semantic-check, explore-claim-reverification-rule
- **Non-goals**: do not modify other steps; do not change the unified gate UX section; do not touch other docs
- Edit `commands/devorch.md`: insert a new section "## Step 7.5 — Plan semantic check" between Step 7 and Step 8. Content must include: (a) explanation of why this exists (catch implicit touches before validate-plan), (b) the four sub-rules (implicit-touch inference, grep verification, silent re-wave, migration check), (c) example of a successful re-wave log line (`Wave reorganizada: tasks 2 e 4 dividem src/index.ts implícito.`), (d) note that if a real bifurcation exists (genuine ambiguity), it surfaces via the unified gate (Step 6 already passed; rare case where Step 7.5 finds a new bifurcation).
- Edit `commands/devorch.md`: add the Explore re-verification rule. Place it as a new bullet at the top of the "## Rules" section near the bottom of the file, or as a sub-section under Step 5 (orchestrator's discretion — pick whichever placement reads more naturally).

</tasks>

<execution>
**Wave 1**: devorch-md-step-7-5-plus-explore-rule
</execution>

<criteria>
- [ ] commands/devorch.md has a new "## Step 7.5 — Plan semantic check" section between Step 7 and Step 8
- [ ] commands/devorch.md has an Explore claim re-verification rule (in Rules or sub-section of Step 5)
- [ ] No other steps are modified or renumbered
- [ ] Step 7.5 mentions all four checks: implicit-touch inference, grep verification, silent re-wave, migration collision
</criteria>

<handoff>
Phase 3 will modify Step 9c of commands/devorch.md to consume the new gotchasByTask shape from init-phase.ts. Phase 2's edits in commands/devorch.md (Step 7.5 + rule) must not collide — Phase 2 inserts BEFORE Step 8 and modifies Rules; Phase 3 modifies Step 9c. No file overlap within a wave; cross-phase is fine.
</handoff>
</phase2>

<phase3 name="init-phase per-task curation + minor mechanical fixes (Conceito B + M.2/M.3/M.4)">
<goal>init-phase.ts emits per-task gotchas, sanitizes XML, accepts injection-token flag for accurate slice gate. commands/devorch.md Step 9c consumes the new shape. Three small mechanical fixes ride along (merge-worktree cwd, validate-plan messages, setup-worktree assertions).</goal>

<spec>
<interface name="gotchas-by-task-schema">
  <input>n/a — output shape change</input>
  <output>init-phase.ts JSON output replaces field `gotchas: string` with `gotchasByTask: Record<taskId, string>`. ALSO emits legacy `gotchas: string` field for backwards-compat (concatenated content of all per-task entries, dedup'd). Per-task content is filtered: include entries whose file:line path begins with any path in the task's `<relevant-files>`, plus all entries WITHOUT explicit file:line (they are global). For tasks with `Repo: <satellite>`, additionally read `<satellitePath>/.devorch/GOTCHAS.md` and merge its entries (filtered same way). Empty string when nothing matches.</output>
</interface>

<behavior name="init-phase-gotchas-sanitization">
  <precondition>init-phase.ts has read raw GOTCHAS.md content (primary or satellite).</precondition>
  <postcondition>Before assigning to `gotchasByTask`, sanitize: (a) strip lines that are pure unbalanced XML closing tags (e.g., bare `</something>` with no matching open in the same entry), (b) for each entry that contains XML-like content (`<...>`), check tag balance and skip the line if unbalanced. Pure mechanical regex/state-machine; no judgment.</postcondition>
</behavior>

<behavior name="init-phase-injection-tokens-flag">
  <precondition>Orchestrator invokes init-phase.ts knowing the approximate token count of `## Explore Findings` it plans to inject per task.</precondition>
  <postcondition>init-phase.ts accepts `--explore-injection-tokens '<json>'` flag where json is `Record<taskId, number>`. Slice gate computes effective tokens as `script-counted-tokens + (injection-tokens[taskId] ?? 0)`. Thresholds remain 3K under / 30K over but applied to effective total. Without the flag, falls back to current behavior (script-counted only).</postcondition>
</behavior>

<behavior name="devorch-md-step-9c-consumes-new-shape">
  <precondition>init-phase.ts now emits gotchasByTask + accepts injection-tokens flag.</precondition>
  <postcondition>commands/devorch.md Step 9c is updated to: (a) when reading init-phase output, prefer `gotchasByTask[task-id]` (skip the `## Gotchas` section entirely if empty for that task); (b) before calling init-phase.ts, the orchestrator estimates the token count of Explore Findings it intends to inject per task and passes them via `--explore-injection-tokens '<json>'`. If estimates are unavailable (resume path), pass empty object.</postcondition>
</behavior>

<behavior name="merge-worktree-deterministic-mainroot">
  <precondition>merge-worktree.ts may be invoked from `<mainRoot>` cwd or from elsewhere; current code relies on cwd assumption.</precondition>
  <postcondition>merge-worktree.ts resolves `mainRoot` deterministically: walks up from `<worktreeName>` argument's resolved path until it finds the directory containing `.worktrees/<name>`, AND that directory is itself a git repo (has `.git/`). If not found, fails with structured error. Replaces any cwd-based heuristics.</postcondition>
</behavior>

<behavior name="validate-plan-spec-ref-clear-error">
  <precondition>A task references a spec name that does not exist among the phase's defined spec children.</precondition>
  <postcondition>Error message format: `Task <task-id> references spec '<missing-name>' which is not defined. Available specs in phase <N>: <comma-separated-list>`. If the list is empty, the message reads `... no specs defined in phase <N>; either define one or remove the Spec ref.`</postcondition>
</behavior>

<behavior name="setup-worktree-post-create-assertions">
  <precondition>setup-worktree.ts has just run `git worktree add` and is about to return.</precondition>
  <postcondition>Before returning success, asserts: (a) `<worktreePath>` exists and is a directory, (b) `git -C <worktreePath> rev-parse --is-inside-work-tree` returns "true". If either fails, returns structured error JSON with `ok: false, error: "post-create-assertion-failed", detail: "<which assertion>"`.</postcondition>
</behavior>
</spec>

<tasks>
#### 1. init-phase.ts — gotchasByTask + sanitization + injection-tokens flag
- **ID**: init-phase-per-task-curation
- **Assigned To**: devorch-builder
- **Spec refs**: gotchas-by-task-schema, init-phase-gotchas-sanitization, init-phase-injection-tokens-flag
- **Non-goals**: do not change other init-phase output fields; do not modify the parsing of plan files; do not break legacy `gotchas` field (emit both); do not touch slice-gate threshold values (3K / 30K stay)
- **Exemplars**: scripts/init-phase.ts (current implementation around lines 100-150 for GOTCHAS read, around lines 421-458 for output construction)
- Refactor gotchas reading: read primary GOTCHAS.md once (cache in memory); read each satellite GOTCHAS.md when first task with that satellite repo is encountered. Build a per-task filter that maps each task's `<relevant-files>` to relevant gotcha entries (entries with file:line path overlapping). Always include entries without file:line (global gotchas). Sanitize each entry before emitting.
- Add CLI flag parsing for `--explore-injection-tokens` (JSON string). Apply to slice-gate calculation.
- Update output JSON: emit BOTH `gotchas` (concatenated/dedup of all per-task entries — for legacy consumers) and `gotchasByTask` (per-task strings).

#### 2. commands/devorch.md Step 9c — consume new gotchasByTask shape + pass injection tokens
- **ID**: devorch-md-step-9c-update
- **Assigned To**: devorch-builder
- **Spec refs**: devorch-md-step-9c-consumes-new-shape
- **Non-goals**: do not modify Step 7.5 (Phase 2's territory); do not modify other steps
- Edit `commands/devorch.md` Step 9c paragraph that lists builder prompt sections: change `from the init-phase 'gotchas' field` to `from init-phase 'gotchasByTask[task-id]' field, omit if empty for that task`.
- Add to Step 9c (or near the start of Step 9): instruction that orchestrator estimates `## Explore Findings` token count per task before invoking init-phase.ts, passes `--explore-injection-tokens '<json>'` flag accordingly. Resume path passes `{}` (no estimates).

#### 3. merge-worktree.ts — deterministic mainRoot resolution
- **ID**: merge-worktree-mainroot-fix
- **Assigned To**: devorch-builder
- **Spec refs**: merge-worktree-deterministic-mainroot
- **Non-goals**: do not refactor merge logic; only the path-resolution block at the top
- **Exemplars**: scripts/setup-worktree.ts has a similar resolveMainRoot() pattern — mirror it
- Locate the cwd/path handling at the start of merge-worktree.ts; replace with deterministic resolver that walks up from worktree path. Surface a clear structured error if mainRoot can't be determined.

#### 4. validate-plan.ts — clearer spec-ref error
- **ID**: validate-plan-error-msg
- **Assigned To**: devorch-builder
- **Spec refs**: validate-plan-spec-ref-clear-error
- **Non-goals**: do not modify other error messages; do not change the validation logic
- Locate the spec-ref check (around lines 301-317 per inventory). Update the error string per the spec. Include the available spec names list comma-separated.

#### 5. setup-worktree.ts — post-create assertions
- **ID**: setup-worktree-post-assertions
- **Assigned To**: devorch-builder
- **Spec refs**: setup-worktree-post-create-assertions
- **Non-goals**: do not modify the existing satellite-untracked guard or .devorch/ copy logic; only add post-create assertions before the success return
- Add the two assertions (path exists + rev-parse) before the success JSON output. Failure path returns structured error JSON consistent with other error returns in the file.

</tasks>

<execution>
**Wave 1** (parallel — no file overlap among the 5 tasks): init-phase-per-task-curation, devorch-md-step-9c-update, merge-worktree-mainroot-fix, validate-plan-error-msg, setup-worktree-post-assertions
</execution>

<criteria>
- [ ] init-phase.ts emits both `gotchas` (legacy) and `gotchasByTask` (new); satellite GOTCHAS.md is read per task; sanitization strips unbalanced XML
- [ ] init-phase.ts accepts `--explore-injection-tokens '<json>'` and applies to slice gate
- [ ] commands/devorch.md Step 9c references `gotchasByTask[task-id]` and instructs orchestrator to pass injection-tokens flag
- [ ] merge-worktree.ts resolves mainRoot deterministically from worktree path
- [ ] validate-plan.ts spec-ref error message includes the missing-name AND available-specs list
- [ ] setup-worktree.ts asserts post-create state and returns structured error on failure
- [ ] `bun scripts/check-project.ts <projectRoot>` (full) passes
</criteria>
</phase3>
