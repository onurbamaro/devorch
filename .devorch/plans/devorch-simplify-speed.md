# Plan: Simplify devorch for faster talk-to-build cycle

<description>
Extract mechanical logic from talk.md and build.md into TypeScript scripts (Principle 3), improve map-conventions.ts to replace Explore-based convention generation, and streamline the talk pipeline by merging steps, making contract verification conditional, and relaxing DA auto-skip.
</description>

<objective>
Reduce talk.md by ~150 lines and build.md by ~80 lines of mechanical logic. Convention regeneration uses improved script instead of Explore agents. Contract verification and DA are conditional on plan classification. Step 3b (specs) merged into step 5 (plan proposal). Total: fewer tokens processed per run + less LLM reasoning on mechanical tasks.
</objective>

<classification>
Type: refactor
Complexity: medium
Risk: high
</classification>

<decisions>
- Strategy → Hybrid C+A: scripts for algorithmic/mechanical logic, unification for instructional text
- Focus → Speed of talk→build cycle, not code cleanup for its own sake
- Builder agents → Leave as-is (duplication doesn't affect speed)
- Scripts lib/ consolidation → Only where needed for correctness (shared sampling logic), not as standalone cleanup
- Convention generation → Improved script as primary, with fallback to 1 quick Explore agent for first-time semantic enrichment
- Contract verification → Conditional: skip for simple+low plans, run for medium+/medium+ risk
- DA auto-skip → Relaxed: simple OR (low AND ≤3 tasks)
- Step 3b (specs) → Merged into step 5 (plan proposal), user approves specs+plan together
- Execution → Worktree path (self-modification risk precludes inline build)
- map-conventions.ts sampling → Increase from 12 to 30 files, update staleness check to match
- ts-morph for non-TS files → Fallback to regex when ts-morph parse fails (covers .vue, .svelte, .js)
- merge-worktree.ts partial failure → Early-exit on first failure, restore all stashed repos, return error JSON
</decisions>

<problem-statement>
devorch's talk.md (~815 lines) and build.md (~540 lines) contain ~200 lines of mechanical logic (merge procedures, retry handling, reviewer dispatch) that the LLM reasons through on every execution. This violates Principle 3 (compute outside the LLM when possible). Convention regeneration uses Explore agents instead of the existing map-conventions.ts script. Contract verification and DA run unconditionally even for simple plans. Step 3b adds a separate approval round for specs.
</problem-statement>

<solution-approach>
1. Create merge-worktree.ts script that encapsulates the full merge procedure (stash, untracked guard, dry-run, merge, restore, cleanup, worktree removal). Unifies the with/without-satellites paths in build.md into a single script with --satellites flag. Both talk.md and build.md call this script instead of inline git logic.

2. Improve map-conventions.ts with ts-morph integration (sharing patterns from tldr-analyze.ts), error handling pattern detection, comment mining for workarounds, and increased sampling (12→30 files). Update check-conventions-staleness.ts to use the same sampling. This eliminates the need for Explore agents during convention regeneration.

3. Update talk.md: replace inline merge logic with script call, convention generation via improved script, merge step 3b into step 5, relax DA auto-skip, make contract verification conditional. Update build.md: replace merge logic with script call (collapsing 2 paths into 1), make contract verification conditional.

Alternatives considered:
- "Talk delegates build via reference" — rejected: runtime can't reliably load another command file into context
- "Full script extraction" (including retry logic) — rejected: retry decisions require LLM reasoning about error context
- "Remove contract verification entirely" — rejected: adds value for complex plans
- "dispatch-reviewers.ts script" — rejected: reviewer logic is ~10 lines and too intertwined with natural language mandates
</solution-approach>

<relevant-files>
- `scripts/map-conventions.ts` — improve with ts-morph, error patterns, comment mining, increased sampling
- `scripts/check-conventions-staleness.ts` — update sampling to match map-conventions.ts
- `scripts/tldr-analyze.ts` — reference for ts-morph patterns (AST analysis, import extraction)
- `scripts/lib/fs-utils.ts` — may need shared extraction helpers
- `commands/talk.md` — replace inline merge, merge steps 3b→5, DA skip, contract conditional, convention via script
- `commands/build.md` — replace merge logic (collapse 2 paths), contract conditional
- `scripts/setup-worktree.ts` — reference for git worktree operations
- `scripts/archive-plan.ts` — reference for archive logic used in merge cleanup
- `scripts/fix-migration-journal.ts` — called by merge script for Drizzle projects

<new-files>
- `scripts/merge-worktree.ts` — encapsulates full merge procedure with JSON output
</new-files>
</relevant-files>

<phase1 name="Foundation Scripts">
<goal>Create merge-worktree.ts and improve map-conventions.ts to provide the foundation for command file simplification.</goal>

<spec>
<interface name="merge-worktree-cli">
  <input>
    --worktree-path: absolute path to worktree being merged
    --main-root: absolute path to main repo
    --original-branch: branch to merge into (e.g., master)
    --branch-name: worktree branch name (e.g., devorch/feature-name)
    --satellites (optional): JSON array of [{name, worktreePath, mainRoot, branch}]
    --skip-worktree-remove (optional): do not remove worktree after merge (for debugging)
  </input>
  <output>
    JSON to stdout:
    {
      status: "success" | "conflict" | "stash-conflict" | "error",
      mergedRepos: string[] (repos that were successfully merged),
      filesChanged: string[] (changed file paths in primary repo),
      stashed: boolean (whether main repo was stashed),
      stashRestored: boolean (whether stash was restored),
      worktreeRemoved: boolean,
      branchDeleted: boolean,
      selfBuildNeeded: boolean (true if scripts/agents/commands/hooks files changed),
      migrationJournalFixed: boolean,
      error: string | null (error message if status != success),
      conflictRepo: string | null (which repo had the conflict),
      conflictFiles: string[] (files in conflict)
    }
  </output>
  <error case="dry-run-conflict">Return status "conflict" with conflictRepo and conflictFiles. Restore any stashed changes. Do NOT merge any repo.</error>
  <error case="stash-pop-failure">Return status "stash-conflict" with conflictFiles. Do NOT continue cleanup. Do NOT remove worktree.</error>
  <error case="partial-satellite-failure">Early-exit on first satellite failure. Restore stashed changes in ALL already-processed repos. Return status "error" with error message identifying the failing repo.</error>
</interface>

<behavior name="merge-atomicity">
  <precondition>All repos (primary + satellites) must pass dry-run before any actual merge</precondition>
  <postcondition>Either ALL repos are merged, or NONE are merged (atomic across repos)</postcondition>
</behavior>

<behavior name="merge-sequence">
  <precondition>Script is called after orchestrator has confirmed merge with user</precondition>
  <postcondition>Script executes: pre-flight stash → untracked file guard → dry-run all repos → merge all repos → restore stash → self-build check → fix migration journal → archive plan → cleanup state files → remove worktree → delete branch</postcondition>
</behavior>

<interface name="map-conventions-improved">
  <input>positional: project root directory (default: cwd)</input>
  <output>
    Markdown to stdout with sections: Naming, Exports & Imports, Style, Error Handling, Patterns, Active Workarounds (from comments), Gotchas (from comments), Testing.
    Error handling section: detected try/catch patterns, process.exit semantics, error output patterns.
    Patterns section: from ts-morph AST analysis — function signatures, import graph clusters, module boundaries.
    Active Workarounds section: mined from TODO/FIXME/HACK/NOTE/WORKAROUND comments.
  </output>
  <error case="ts-morph-parse-failure">Per-file fallback to regex analysis. Log warning to stderr. Continue with remaining files.</error>
</interface>

<behavior name="sampling-consistency">
  <precondition>map-conventions.ts and check-conventions-staleness.ts use the same file sampling logic</precondition>
  <postcondition>Both scripts sample the same set of files (up to 30) using shared constants and collection function</postcondition>
</behavior>

<invariant>ts-morph failures on individual files (e.g., .vue, .svelte) must not prevent analysis of remaining files</invariant>
</spec>

<tasks>
#### 1. Create merge-worktree.ts script
- **ID**: create-merge-script
- **Assigned To**: builder-1
- **Model**: opus
- **Effort**: high
- **Spec refs**: merge-worktree-cli, merge-atomicity, merge-sequence
- Implement `scripts/merge-worktree.ts` following the merge-worktree-cli interface spec exactly
- Translate the merge procedure from build.md steps 4a-4g (lines ~360-484) and talk.md step 10i (lines ~510-570) into a single script
- Unify with-satellites and without-satellites paths: when `--satellites` is provided, iterate all repos; without it, only process primary
- Use `Bun.spawn()` for all git commands with explicit `-C <path>` flags (never depend on cwd)
- Implement self-build detection: check if changed files (from `git diff --name-only`) start with `scripts/`, `agents/`, `commands/`, or `hooks/` AND `install.ts` exists in main root
- Call `fix-migration-journal.ts` when Drizzle migrations are detected (check for `drizzle/` directory)
- Call `archive-plan.ts` for plan archival (detect plan path from worktree `.devorch/plans/`)
- Delete `.devorch/state.md`, `.devorch/explore-cache-*.md`, `.devorch/project-map.md` from main root during cleanup
- Commit cleanup files: `chore(devorch): cleanup post-merge <plan name>`
- Handle all error paths per spec: dry-run-conflict, stash-pop-failure, partial-satellite-failure
- Output JSON to stdout, human-readable messages to stderr

#### 2. Improve map-conventions.ts and update staleness check
- **ID**: improve-conventions-script
- **Assigned To**: builder-2
- **Model**: opus
- **Effort**: medium
- **Spec refs**: map-conventions-improved, sampling-consistency
- **ts-morph integration**: Extract the AST analysis patterns from `scripts/tldr-analyze.ts` (function signature extraction, import graph, interface shapes) and apply them in map-conventions.ts. Create a shared helper in `scripts/lib/` if needed, or inline the relevant ts-morph calls
- **Error handling detection**: Add regex patterns for `try {`, `catch`, `process.exit(`, `console.error(` — cluster co-occurrence to detect patterns (silent fallback vs throwing vs exit-code)
- **Comment mining**: Scan for lines containing TODO, FIXME, HACK, NOTE, WORKAROUND, "because" (case-insensitive). Group by keyword. Output as "Active Workarounds" section when HACK/WORKAROUND/NOTE found, and "Gotchas" when TODO/FIXME found with surrounding context
- **Increase sampling**: Change file cap from 12 to 30. Increase maxPerDir from 5 to 8. Read first 80 lines instead of 50 for pattern detection
- **ts-morph fallback**: Wrap ts-morph calls in per-file try/catch. On parse failure (likely for .vue, .svelte, plain .js without types), fall back to regex-only analysis for that file. Log warning to stderr
- **Update check-conventions-staleness.ts**: Extract shared constants (CODE_EXTS, SAMPLE_DIRS, IGNORE) and `collectFiles` function to a shared location (either `lib/fs-utils.ts` or inline both from same source). Update `check-conventions-staleness.ts` to use the same 30-file, 80-line sampling. The staleness hash must be computed over the exact same file set as the conventions
- **Output format**: Keep markdown output. Add new sections: `## Error Handling`, `## Active Workarounds` (from comments), `## Gotchas` (from comments). Enhance `## Patterns` with ts-morph findings (function signatures by pattern, import clusters)

</tasks>

<execution>
**Wave 1** (parallel): create-merge-script, improve-conventions-script
</execution>

<criteria>
- [ ] `bun scripts/merge-worktree.ts --help` shows usage (or runs without error with --worktree-path etc.)
- [ ] merge-worktree.ts handles: success, conflict, stash-conflict, partial-satellite-failure paths
- [ ] merge-worktree.ts outputs valid JSON to stdout in all paths
- [ ] map-conventions.ts run on devorch repo produces richer output than before (Error Handling, Workarounds, Gotchas sections present)
- [ ] ts-morph analysis produces function signature patterns and import clusters
- [ ] check-conventions-staleness.ts uses same sampling as map-conventions.ts (same constants, same file count)
- [ ] No TypeScript compilation errors across all modified scripts
</criteria>

<handoff>
merge-worktree.ts JSON interface is stable. Phase 2 builders must call the script with the exact flags and parse the exact JSON fields defined in the merge-worktree-cli spec. map-conventions.ts output format is markdown with the new sections — talk.md convention generation step should reference this directly.
</handoff>
</phase1>

<phase2 name="Command File Simplification">
<goal>Update talk.md and build.md to use the new scripts, merge steps, and add conditional logic for contract verification and DA.</goal>

<spec>
<behavior name="talk-merge-via-script">
  <precondition>merge-worktree.ts exists and produces JSON per merge-worktree-cli spec</precondition>
  <postcondition>talk.md step 10i replaces all inline merge logic with a single script call + JSON parsing. On success: report merged. On conflict/error: report error from JSON. On stash-conflict: report files from JSON. Self-build reinstall triggered based on selfBuildNeeded field.</postcondition>
</behavior>

<behavior name="build-merge-via-script">
  <precondition>merge-worktree.ts exists and produces JSON per merge-worktree-cli spec</precondition>
  <postcondition>build.md step 4/5 replaces both with-satellites and without-satellites merge paths with a single script call + JSON parsing. Same field handling as talk-merge-via-script.</postcondition>
</behavior>

<behavior name="specs-in-plan">
  <precondition>Step 3b (Propose specs) currently exists as a separate step with its own AskUserQuestion round</precondition>
  <postcondition>Step 3b is removed as a standalone step. Spec drafting logic is merged into step 5 (Propose plan) or step 6 (Design solution). Specs appear within the plan display for unified approval. The AskUserQuestion for spec confirmation is eliminated — user approves plan+specs together.</postcondition>
</behavior>

<behavior name="conditional-contract-verification">
  <precondition>Contract verification currently runs for all tasks with Spec refs</precondition>
  <postcondition>Contract verification is skipped when the plan classification is complexity="simple" AND risk="low". The skip is logged: "Contract verification skipped — simple/low plan". For all other classifications, verification runs as before.</postcondition>
</behavior>

<behavior name="relaxed-da-skip">
  <precondition>DA auto-skip requires ALL of: simple, low, ≤2 tasks, 1 phase, no secondary-repos</precondition>
  <postcondition>DA auto-skip triggers when: (complexity="simple") OR (risk="low" AND total tasks ≤ 3). Secondary-repos check remains (plans with satellites always get DA).</postcondition>
</behavior>

<behavior name="convention-via-script">
  <precondition>Convention regeneration currently launches 1-2 Explore agents at "very thorough"</precondition>
  <postcondition>Convention regeneration runs `bun map-conventions.ts <project-root>` and writes the output to CONVENTIONS.md. For FIRST-TIME generation only (no previous CONVENTIONS.md exists), additionally launch 1 Explore agent at "quick" thoroughness to add semantic context (architectural patterns, workaround explanations) that the script cannot capture. For REGENERATION on staleness (CONVENTIONS.md already exists), script only — no Explore agents.</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Update talk.md — script calls, merge steps, conditional logic
- **ID**: update-talk
- **Assigned To**: builder-3
- **Model**: opus
- **Effort**: high
- **Spec refs**: talk-merge-via-script, specs-in-plan, conditional-contract-verification, relaxed-da-skip, convention-via-script
- **Step 1 (Convention generation)**: Replace the Explore-agent-based convention generation (the "If missing" block, ~20 lines) with: run `bun $CLAUDE_HOME/devorch-scripts/map-conventions.ts <project-root>`, write output to `.devorch/CONVENTIONS.md`. For first-time only: additionally launch 1 Explore agent at "quick" to enrich with semantic context. For staleness regeneration: script only
- **Step 3b removal**: Remove step 3b (Propose specs) as a standalone step. Move the spec drafting guidance into step 6 (Design solution) — specs are designed as part of the solution. Move the spec display into step 5 (Propose plan) — specs appear within the plan for unified approval. Remove the separate AskUserQuestion for spec confirmation
- **Step 6b (DA auto-skip)**: Change the auto-skip condition from the current 5-condition AND to: `(complexity == "simple") OR (risk == "low" AND totalTasks <= 3)`. Keep the secondary-repos check (plans with satellites always get DA). Update the log message: "DA skipped — simple plan" or "DA skipped — low-risk plan with ≤3 tasks"
- **Step 8i(b) (Contract verification)**: Add a classification check before the per-task contract verification loop. If `complexity == "simple" AND risk == "low"`, skip the entire verification block and log: "Contract verification skipped — simple/low plan"
- **Step 10i (Merge)**: Replace ALL inline merge logic (steps 1-9, ~55 lines) with: `bun $CLAUDE_HOME/devorch-scripts/merge-worktree.ts --worktree-path <projectRoot> --main-root <mainRoot> --original-branch <originalBranch> --branch-name devorch/<name>`. Parse JSON output. Route by status: "success" → report merged + handle selfBuildNeeded; "conflict" → report conflictRepo and conflictFiles; "stash-conflict" → report files and manual resolution instructions; "error" → report error message. Keep the verdict report format (Verificação Final) and feedback logging — those stay in the .md
- **Renumber steps carefully**: After removing 3b, step numbering changes. Update all internal cross-references (e.g., "return to Step 2", "continue to Step 6")

#### 2. Update build.md — script call, conditional contract verification
- **ID**: update-build
- **Assigned To**: builder-4
- **Model**: opus
- **Effort**: high
- **Spec refs**: build-merge-via-script, conditional-contract-verification
- **Step 4/5 (Merge)**: Replace BOTH the "With satellites" path (step 5, ~60 lines) and the "Without satellites" path (step 5 alternative, ~55 lines) with a SINGLE merge path: Build satellites JSON from plan `<secondary-repos>` if present. Call `bun $CLAUDE_HOME/devorch-scripts/merge-worktree.ts --worktree-path <worktreePath> --main-root <mainRoot> --original-branch <mainBranch> --branch-name <branch> [--satellites '<json>']`. Parse JSON output. Route by status field. Keep the verdict report and success/failure messaging — those stay in the .md
- **Step 2c (Contract verification)**: Add classification check before the per-task contract verification loop. If `complexity == "simple" AND risk == "low"`, skip and log: "Contract verification skipped — simple/low plan". This requires reading the plan's `<classification>` section at phase init time — check if init-phase.ts already exposes classification in its JSON output. If not, note it as a requirement for a follow-up (do NOT modify init-phase.ts in this task)
- **Collapse merge sections**: The current build.md has step 4 (pre-merge stash, "On SUCCESS" header) leading into two parallel sections (with/without satellites). After the refactor, there should be ONE merge section that calls the script. Remove the duplicated sub-steps (untracked guard, dry-run, merge, stash restore, self-build, migration journal, cleanup, worktree remove) — all handled by the script
- **Update step references**: If step numbers change due to collapsing, update internal cross-references

</tasks>

<execution>
**Wave 1** (parallel): update-talk, update-build
</execution>

<criteria>
- [ ] talk.md step 10i merge logic is a single script call + JSON parsing (no inline git commands for merge)
- [ ] talk.md step 3b is removed; specs appear within plan proposal
- [ ] talk.md DA auto-skip uses relaxed condition
- [ ] talk.md contract verification is conditional on classification
- [ ] talk.md convention generation uses improved script (not Explore agents for regeneration)
- [ ] build.md merge logic is a single script call (with/without satellites paths collapsed)
- [ ] build.md contract verification is conditional on classification
- [ ] No broken cross-references in either file
- [ ] Both files maintain correct Portuguese pt-BR for user-facing text and English for technical content
</criteria>
</phase2>
