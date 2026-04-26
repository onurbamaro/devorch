# Plan: Inline Build and Cache Isolation

<description>
Add inline build capability to /devorch:talk (execute plan directly without worktree for simple tasks) and isolate explore-cache per plan to prevent concurrent plan interference. Improve setup-worktree.ts resilience and speed.
</description>

<objective>
Talk command offers inline or worktree build after plan generation, with heuristic recommendation based on total task count. Inline builds create a branch, execute phases, verify with 3 adversarial reviewers, and auto-merge. Explore-cache uses per-plan naming (`explore-cache-<name>.md`) eliminating conflicts between concurrent plans. Setup-worktree.ts handles orphan worktrees gracefully and creates satellites in parallel.
</objective>

<classification>
Type: Feature + Refactor
Complexity: Medium
Risk: Low
</classification>

<decisions>
- Inline build trigger → Always offer, recommend inline if totalTasks ≤ 8 AND single-repo
- Inline isolation → Branch `devorch/<name>` in main repo, auto-merge on success, preserve branch on failure
- Inline plan storage → Ephemeral (`.devorch/plans/<name>.md`), deleted after merge, summary in merge commit
- Inline verification → Full (3 adversarial reviewers + check-project), same as worktree builds
- Inline satellites → Not supported — multi-repo always uses worktree
- explore-cache → Per-plan naming: `.devorch/explore-cache-<name>.md`
- Cache name source → Derived from worktree/branch name, passed via `--cache-name` parameter
- Backward compat → Scripts fall back to `explore-cache.md` when `--cache-name` not provided
- Large plans → Keep current worktree-based flow (talk → /clear → build) unchanged
- setup-worktree.ts → Parallel satellite creation, structured JSON errors, shared createWorktree function
</decisions>

<problem-statement>
Three pain points:
1. Concurrent plans on the same project interfere via shared `explore-cache.md` in the main repo
2. Simple tasks (≤8 tasks) require full worktree ceremony adding ~30-40s overhead + an extra user interaction (/clear + /devorch:build)
3. setup-worktree.ts lacks graceful error handling for orphan worktrees/branches and creates satellites sequentially
</problem-statement>

<solution-approach>
1. Per-plan cache naming via `--cache-name` parameter in init-phase.ts and manage-cache.ts. build.md derives cache name from plan path. Backward-compatible fallback to `explore-cache.md`.
2. Inline build path in talk.md: after plan generation, heuristic recommends inline (≤8 tasks, single-repo) or worktree. Inline creates branch, executes phases with existing scripts (init-phase, check-project, phase-summary), runs full verification, and auto-merges.
3. setup-worktree.ts: async satellite creation, structured JSON error output, shared worktree creation function.
Alternative considered: native `isolation: "worktree"` — rejected because it lacks named branches, satellites, sparse checkout, and .devorch file copying.
</solution-approach>

<relevant-files>
- `scripts/init-phase.ts` — add --cache-name parameter for per-plan cache resolution
- `scripts/manage-cache.ts` — add --cache-name parameter
- `commands/build.md` — derive cache-name from plan, pass to scripts, update cleanup
- `scripts/setup-worktree.ts` — resilience, speed, simplicity improvements
- `commands/talk.md` — inline build feature, cache naming, new plan options
</relevant-files>

<phase1 name="Cache Isolation, Script Improvements, and Inline Build">
<goal>Add per-plan cache naming to scripts and build command, improve setup-worktree.ts, and add inline build capability to talk.md.</goal>

<tasks>
#### 1. Per-plan Cache Naming in Scripts and Build Command
- **ID**: cache-naming
- **Assigned To**: builder-cache
- **init-phase.ts** (`scripts/init-phase.ts`):
  - Add `--cache-name` optional string parameter to parseArgs (line ~37, alongside existing plan, phase, cache-root)
  - Update cache resolution (line ~102): when cacheName provided, resolve as `resolve(cacheRootDir, ".devorch", \`explore-cache-${cacheName}.md\`)`. When not provided, fall back to `resolve(cacheRootDir, ".devorch", "explore-cache.md")` — where cacheRootDir is `cacheRoot || projectRoot`
  - The per-task cache filtering (line ~424) already uses `cacheRaw` from the resolved source — no changes needed there
  - Update file header comment to document `--cache-name` usage
- **manage-cache.ts** (`scripts/manage-cache.ts`):
  - Add `--cache-name` optional string parameter
  - When provided, operate on `explore-cache-<cacheName>.md` instead of `explore-cache.md`
  - When not provided, fall back to `explore-cache.md` (backward compat)
  - Update file header comment
- **build.md** (`commands/build.md`):
  - In step 0 (Resolve plan path, around line 20-36): after resolving planPath and projectRoot, derive cacheName. Logic: if planPath contains `.worktrees/<name>/`, extract `<name>` as cacheName. Else if planPath is `.devorch/plans/<filename>.md`, use filename without extension. Fallback: derive from plan title via kebab-case. Store as `cacheName` variable for use in subsequent steps.
  - In step 2a (Init phase, line ~61): add `--cache-name <cacheName>` to init-phase.ts call
  - In step 2f (Cache management, line ~145): add `--cache-name <cacheName>` to manage-cache.ts call
  - In step 4c (Post-merge cleanup, lines ~309-314): change "Delete `.devorch/explore-cache.md`" to "Delete `.devorch/explore-cache-<cacheName>.md`. Also delete `.devorch/explore-cache.md` if it exists (backward compat cleanup)."

#### 2. Worktree Script Improvements
- **ID**: worktree-improvements
- **Assigned To**: builder-worktree
- **Speed**: Convert the sequential `for (const repo of secondaryRepos)` loop in `createSatellites()` (line ~145) to parallel execution. Since each satellite operates on a different repo path, they're independent. Use `Promise.all` with async functions using `Bun.spawn` (not spawnSync) for satellite git operations. Keep primary worktree creation synchronous (it must complete before satellites). Make `createSatellites()` async and await it. The main script entry point needs a top-level async wrapper or use top-level await.
- **Resilience**:
  - When worktree already exists without `--recreate` (line ~264-269): output structured JSON `{"error": "exists", "worktreePath": "<path>", "branch": "<branch>", "hint": "use --recreate to replace"}` to stdout and exit code 1 (instead of `console.error` with plain string)
  - When branch exists but worktree doesn't — orphan branch (line ~271-282): output JSON `{"error": "orphan-branch", "branch": "<branch>", "hint": "use --recreate to clean up"}` and exit code 1
  - Same structured JSON errors for satellite worktree conflicts (lines ~159-182)
- **Simplicity**: Extract shared function `createSingleWorktree(opts: { repoPath: string, worktreePath: string, branchName: string, sparsePaths?: string, recreate?: boolean }): { warnings: string[] }` that handles: ensure .gitignore has `.worktrees/` entry, `mkdirSync` parent dir, `git worktree add`, apply sparse-checkout if sparsePaths provided. Use this function for both primary (line ~300-316) and satellite (lines ~204-233) creation, replacing the duplicated logic.

#### 3. Talk Command — Inline Build and Cache Naming
- **ID**: talk-inline-build
- **Assigned To**: builder-talk
- Read current `commands/talk.md` and `commands/build.md` to understand both flows before making changes.
- **After Step 1 (Load context), add Step 1b — Derive plan name**:
  Add a new sub-step: "Derive a preliminary kebab-case name from $ARGUMENTS (3-5 descriptive words, lowercase, hyphenated). This name is used for: explore cache file, branch name (inline builds), and worktree name (worktree builds). The name may be refined later when the plan title is finalized — if so, rename the cache file."
- **Step 2 (Explore)**: Change the explore-cache output path in the format block at the end from `.devorch/explore-cache.md` to `.devorch/explore-cache-<name>.md`
- **Step 4 (Deep exploration)**: Update "Append findings to `.devorch/explore-cache.md`" to `.devorch/explore-cache-<name>.md`
- **Step 5 (Propose plan) — REPLACE entirely with**:
  Count total tasks across all phases in the designed plan. Show summary: "Plano: N fases, M tasks, K waves." Use AskUserQuestion with these options:
  If totalTasks ≤ 8 AND no `<secondary-repos>` in plan:
  - Option 1: "Executar agora — inline build" (Recommended) — "Cria branch, executa fases, verifica e faz merge automático. Ideal para tarefas simples"
  - Option 2: "Criar worktree para build separado" — "Worktree isolada + /devorch:build em sessão separada. Melhor para tarefas complexas ou paralelas"
  If totalTasks > 8 OR has `<secondary-repos>`:
  - Option 1: "Criar worktree para build separado" (Recommended) — same description
  - Option 2: "Executar agora — inline build" — same description
  Always include:
  - Option 3: "Continuar explorando"
  - Option 4: "Encerrar — tenho o que precisava"
  Route: option explore → Step 2, option end → summarize and stop, option worktree → Step 6 then WORKTREE PATH, option inline → Step 6 then INLINE PATH
- **Step 6 (Design solution)**: No changes — applies to both paths
- **Steps 7-11 — WORKTREE PATH**: Keep current steps 7-11 with these updates:
  - Step 7 (Create plan): use `<name>` from step 1b as the worktree name passed to setup-worktree.ts
  - Step 10 (Commit main repo): stage `.devorch/explore-cache-<name>.md` instead of `explore-cache.md`
  - Step 11 (Suggest next): include `--plan <name>` for the build command
- **Steps 7-11 — INLINE PATH** (NEW section, add after the worktree path):
  Step 7i (Create plan inline): Write plan to `.devorch/plans/<name>.md` (NOT `current.md`). Validate: `bun validate-plan.ts --plan .devorch/plans/<name>.md`. Fix if blocked. Delete `.devorch/state.md` if exists.
  Step 8i (Create branch): Record current branch `git branch --show-current` → `originalBranch`. Create: `git checkout -b devorch/<name>`.
  Step 9i (Phase loop): For each phase N sequentially:
    (a) Init: `bun init-phase.ts --plan .devorch/plans/<name>.md --phase N --cache-name <name>`. Parse JSON, read contentFile if present.
    (b) Deploy builders: For each wave, launch builders as foreground parallel Agent calls (`subagent_type="devorch-builder"`). Each builder receives: plan objective + decisions + solution approach (from init output), full task details from tasks map, conventions from conventionsByTask[taskId], cache from cacheByTask[taskId]. Include effort guidance and commit instruction. CRITICAL: builders call TaskUpdate with status "completed".
    (c) Validate: if totalPhases == 1, skip. If > 1: `bun check-project.ts <cwd> --quick`. Fix failures or stop.
    (d) Summary: `bun phase-summary.ts --plan .devorch/plans/<name>.md --phase N --status "ready for phase $((N+1))" --summary "<summary>"`. Commit if changes exist.
    (e) Cache: `bun manage-cache.ts --action invalidate,trim --max-lines 3000 --cache-name <name>`
  Step 10i (Final verification): Same as build command step 3. Determine changed files: `git diff --name-only <originalBranch>...HEAD`. Launch 3 adversarial reviewers (security, quality, completeness) as foreground parallel Agent calls (`subagent_type="Explore"`), each receives working directory, plan objective, CONVENTIONS.md, changed files list. Inline cross-phase check (imports, exports, TODOs, type consistency). Fix trivial findings inline, fix-level via devorch-builder agents. Post-review: `bun check-project.ts <cwd>`. Report.
  Step 11i (Merge + cleanup): On SUCCESS: (1) `git checkout <originalBranch>`, (2) `git merge devorch/<name>` with commit message: `type(scope): <objective>` + body with plan summary (phases, tasks, key changes), (3) `git branch -d devorch/<name>`, (4) Delete `.devorch/plans/<name>.md`, `.devorch/explore-cache-<name>.md`, `.devorch/state.md`, `.devorch/project-map.md`, (5) commit cleanup: `chore(devorch): cleanup inline build <name>`, (6) Report verdict (same format as build command step 3d). On FAILURE: Do NOT merge, report "Build inline falhou na fase N. Branch `devorch/<name>` preservada com M commits.", suggest `/devorch:fix`.
- **Rules section**: Add: "Inline builds are single-repo only. Plans with `<secondary-repos>` always use the worktree path."
- **Legacy plan migration** (Step 1): Keep as-is. Additionally, clean up any stale `.devorch/explore-cache-*.md` files older than 7 days.

</tasks>

<execution>
**Wave 1** (parallel): cache-naming, worktree-improvements
**Wave 2** (after wave 1): talk-inline-build
</execution>

<criteria>
- [ ] init-phase.ts accepts --cache-name and resolves per-plan cache file
- [ ] init-phase.ts falls back to explore-cache.md when --cache-name not provided
- [ ] manage-cache.ts accepts --cache-name and operates on named cache file
- [ ] build.md derives cacheName from plan path and passes --cache-name to scripts
- [ ] build.md post-merge cleanup deletes named cache file
- [ ] setup-worktree.ts satellites create in parallel (async, not sequential)
- [ ] setup-worktree.ts outputs structured JSON for existing worktree/orphan branch errors
- [ ] setup-worktree.ts has shared createSingleWorktree function
- [ ] talk.md derives plan name early and uses it for explore-cache naming
- [ ] talk.md Step 5 offers inline vs worktree with task-count heuristic
- [ ] talk.md inline path creates branch, executes phases, runs full verification, auto-merges
- [ ] talk.md inline path preserves branch on failure with clear report
- [ ] talk.md worktree path uses per-plan cache naming
- [ ] Multi-repo plans excluded from inline build option
</criteria>
</phase1>
