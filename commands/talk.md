---
description: "Conversa + exploração + plano estruturado"
argument-hint: "<o que quer fazer, explorar ou discutir>"
model: opus
disallowed-tools: EnterPlanMode
---

Conversation, exploration, and structured planning for devorch projects.

**Input**: $ARGUMENTS (description of what you want to do, explore, or discuss). If empty, stop and ask the user.

## Steps

### 1. Load context

**Project data**: Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` to collect tech stack, folder structure, dependencies, and scripts. Use this output as inline context — do not save it to a file. If the script fails (no Bun, etc.), gather equivalent data via an Explore agent.

**New project detection**: If map-project.ts output shows no source code files and no dependencies (empty or scaffold-only project), enter discovery mode:

1. **Product discovery** — Use `AskUserQuestion` (2-3 questions at a time, adaptive):
   - What the product does (elevator pitch)
   - Target audience
   - Essential MVP features (max 5)
   - Scope boundaries (what it does NOT do)

2. **Technical discovery** — Use `AskUserQuestion`:
   - Language/runtime (suggest based on product type)
   - Framework (suggest 2-3 options with trade-offs)
   - Database, authentication, deployment (if applicable)

3. **Validate scope** — Summarize MVP back to user. Confirm nothing is missing or should be removed. MVP should be achievable in 3-5 build phases.

4. **Generate architecture** — Write `.devorch/ARCHITECTURE.md`:

   ```markdown
   # Architecture

   ## Structure
   [Proposed folder structure]

   ## Data Model
   [Key entities and relationships]

   ## API Design
   [Key endpoints or interfaces]

   ## Patterns
   [Architectural patterns chosen and why]
   ```

After discovery, skip CONVENTIONS.md generation (no code to analyze yet). Continue to **Step 3** (Clarify) for implementation-specific questions about the first milestone.

**Conventions** (existing projects only): Read `.devorch/CONVENTIONS.md`.

- **If missing**: Generate it now. Launch 1-2 Explore agents (Agent tool with `subagent_type="Explore"`, thoroughness "very thorough") to investigate:
  - **Architectural patterns** — how services/modules are structured, DI, middleware chains, state management, error handling patterns
  - **Active workarounds** — patterns builders must preserve and why (e.g., "json-bigint used because IDs exceed MAX_SAFE_INTEGER")
  - **Gotchas** — things a builder needs to know to avoid mistakes

  Write `.devorch/CONVENTIONS.md` from Explore findings using this format:

  ```markdown
  # Code Conventions

  ## Patterns
  <component structure, service patterns, state management, error handling — from Explore findings>

  ## Active Workarounds
  <workarounds builders must preserve, and why they exist>
  (skip section if none found)

  ## Gotchas
  <things a builder needs to know to avoid mistakes>
  ```

  **Sampling rule:** When a section has many files (50+ components, 20+ routes), read 3-5 representative files to identify the pattern. Stop when the pattern is clear.

- **If exists**: Quick staleness check — compare library names mentioned in CONVENTIONS.md against current `package.json` dependencies. If CONVENTIONS.md references libraries no longer in package.json (or major new dependencies aren't reflected), regenerate it using the process above.

**Legacy plan migration**: If `.devorch/plans/current.md` exists in the main repo, archive it silently: run `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan .devorch/plans/current.md`. Report: "Migrated legacy plan to archive." Plans now always live in worktrees — this path only triggers once during migration.

**Stale cache cleanup**: Delete any `.devorch/explore-cache-*.md` files older than 7 days.

### 1b. Derive plan name

Derive a preliminary kebab-case name from $ARGUMENTS (3-5 descriptive words, lowercase, hyphenated). This name is used for: explore cache file, branch name (inline builds), and worktree name (worktree builds). The name may be refined later when the plan title is finalized — if so, rename the cache file accordingly (e.g., `mv .devorch/explore-cache-<old-name>.md .devorch/explore-cache-<new-name>.md`).

Store this as `<name>` for all subsequent steps.

### 2. Explore

Analyze $ARGUMENTS and determine 2-3 distinct exploration focuses relevant to the task. Consider: architecture/integration, risks/edge cases, existing patterns/conventions.

Launch 2-3 Explore agents (Agent tool with `subagent_type="Explore"`) in parallel in a single message. Each agent receives: a specific focus area (distinct from other agents), $ARGUMENTS, CONVENTIONS.md content (if it exists). Use thoroughness "very thorough" for the primary exploration.

**Effort guidance**: Focus on information gathering. Be concise in summaries — report findings, not reasoning process. Prioritize breadth over depth.

After all return: write combined findings to `.devorch/explore-cache-<name>.md` with format:
```markdown
# Explore Cache
Generated: <ISO timestamp>

## <area-name-1>
<summary from explorer 1>

## <area-name-2>
<summary from explorer 2>
```

### 3. Clarify with the user (never skip)

Use `AskUserQuestion` to eliminate **every** ambiguity, gray area, and open question before planning. Each question must have 2-4 clickable options (the user can always type a custom answer). This step prevents expensive rework later — an unanswered question now becomes a wrong assumption in the plan.

**This step is mandatory.** Even if the request seems clear, the exploration will reveal decisions that need user input — approach choices, scope boundaries, behavior in edge cases. Ask about those. Additionally:
- Cover explicitly any gray areas the explorers identified
- Ask about things the user likely did not think of (discovered by explorers)

**What to ask about** (cover ALL that apply — no artificial limit on number of questions):

- **Scope** — Does the user want just X, or also Y? Should it handle edge case Z?
- **Approach** — When multiple architectures or patterns are viable, which does the user prefer?
- **Constraints** — Backward compatibility? Performance targets? Specific libraries to use or avoid?
- **Behavior** — What should happen on error? What's the UX for edge cases?
- **Priority** — Speed vs completeness? MVP vs full implementation?
- **Integration** — Should this connect to existing feature X? Replace or extend current behavior?
- **Naming / conventions** — When the codebase doesn't have a clear precedent for something, ask.
- **Contracts & specs** — What are the input/output contracts? What error cases must be handled? What invariants must hold? What API shapes are needed?
- **Edge cases** — Anything the exploration revealed that has no obvious right answer.
- **Multi-repo** — When the task involves or mentions multiple projects/repos, ask which secondary repos should be included as satellites. Present discovered repo paths as options. Each satellite gets its own worktree with the same branch name.
- **Sibling repos (automatic)** — If the map-project.ts output from Step 1 contains a "## Sibling Repos" section, include a question asking which of those repos should be satellites for this plan. List each detected repo as an option (name + relative path). Always include the option "Nenhum — só o repo principal" as the last choice. This question should appear even if the user did not explicitly mention multi-repo.

**Ask in rounds.** Use up to 4 questions per `AskUserQuestion` call (tool limit). If more questions remain, make another call after the user answers. Continue until all ambiguity is resolved — there is no cap on rounds. The goal is **zero assumptions** in the plan.

**Reflection pass (after all rounds complete).** Before moving on, step back and review the full picture: the original request, exploration findings, and all user answers so far. Consider what the user might want but didn't explicitly ask for — common causes:
- **Short or vague prompt** — the user had a clear mental picture but described only part of it.
- **Assumed obvious** — features or behaviors the user takes for granted but never stated (e.g., error feedback, loading states, undo, accessibility, mobile responsiveness).
- **Adjacent functionality** — things that naturally complement the request (e.g., user asked for "create" but probably also needs "edit" and "delete"; asked for an API endpoint but probably needs validation and error responses).
- **Operational concerns** — logging, monitoring, rollback, migration path, performance under load.
- **Things the exploration revealed** that the user likely doesn't know about (hidden dependencies, undocumented constraints, patterns the codebase already follows that affect this work).

If this reflection surfaces new questions or suggestions, present them in a final `AskUserQuestion` round framed as: "Revisando tudo que discutimos, pensei em mais algumas coisas que podem ser relevantes:" — with options including "Já está bom, seguir em frente" as the last choice. If nothing new surfaces, proceed silently.

### 3b. Propose specs

Based on exploration findings and user answers, draft spec contracts for each planned phase. **Display the specs as formatted text directly in the chat** — do NOT put them inside `AskUserQuestion`. Group specs by phase using markdown headers and code blocks. Include concrete examples derived from the exploration (real function names, real error cases discovered).

After displaying all specs, use `AskUserQuestion` with a simple confirmation prompt: options like "Aprovado — seguir com essas specs", "Quero ajustar algumas specs (vou detalhar)", "Rejeitar e repensar". If the user wants adjustments, apply them and re-display only the changed specs for a second confirmation.

**Guidelines:**
- Ground specs in what the exploration found — reference real files, patterns, or constraints discovered.
- Don't spec what the codebase or conventions already define.
- Don't ask the user to make decisions you're better equipped to make (pure implementation details).

### 4. Deep exploration (conditional)

If user answers revealed new areas to explore, launch additional Explore agents targeted by the user's choices. Append findings to `.devorch/explore-cache-<name>.md`.

Use the Agent tool with `subagent_type="Explore"` for all codebase exploration. **Do NOT read source files directly** — use Explore agent summaries as your evidence base. Use Grep directly only for quantification (counting imports, usage patterns).

**Evidence-based planning**: every task must reference real files discovered by Explore agents, not assumptions. Quantify: "Update 14 files that import from X", not "Update files".

### 5. Propose plan

Count total tasks across all phases in the designed plan. Show summary: "Plano: N fases, M tasks, K waves."

Use `AskUserQuestion` with options based on plan characteristics:

**If totalTasks ≤ 8 AND no `<secondary-repos>` in plan:**
- Option 1: "Executar agora — inline build" (Recommended) — "Cria worktree otimizada, executa fases, verifica e faz merge automático. Ideal para tarefas simples"
- Option 2: "Criar worktree para build separado" — "Worktree isolada + /devorch:build em sessão separada. Melhor para tarefas complexas ou paralelas"

**If totalTasks > 8 OR has `<secondary-repos>`:**
- Option 1: "Criar worktree para build separado" (Recommended) — "Worktree isolada + /devorch:build em sessão separada. Melhor para tarefas complexas ou paralelas"
- Option 2: "Executar agora — inline build" — "Cria worktree otimizada, executa fases, verifica e faz merge automático. Ideal para tarefas simples"

**Always include:**
- Option 3: "Continuar explorando"
- Option 4: "Encerrar — tenho o que precisava"

**Routing:**
- Option explore → return to Step 2 with new focus
- Option end → summarize findings and stop
- Option worktree → continue to Step 6, then follow **WORKTREE PATH** (Steps 7-11)
- Option inline → continue to Step 6, then follow **INLINE PATH** (Steps 7i-10i)

### 6. Design solution (medium/complex only)

**Effort guidance**: Think deeply. Consider alternatives, edge cases, and long-term implications. This is where reasoning depth matters most.

Think through: core problem, approach, alternatives considered, risks and mitigations.

Include `<spec>` section design as part of solution design. Each phase should have specs that define the contracts builders must implement. Prefer fewer, more precise specs over many vague ones.

#### Phase consolidation guidance

Prefer **fewer, denser phases** over many thin ones. With 1M context, the orchestrator handles phases inline — each additional phase adds ~2-3 min overhead (init + check + summary). Consolidate when safe.

**When to merge adjacent phases** (both conditions must hold):
- Both phases have ≤3 tasks each
- No cross-phase file conflicts (no file modified in both phases)
- No mandatory handoff context needed (phase B doesn't depend on phase A's runtime output)

**When NOT to merge**:
- Tasks in phase B depend on phase A's committed outputs (e.g., generated files, schema changes)
- Shared file modifications across phases — two builders in the same wave cannot edit the same file
- Phase A's checks must pass before phase B's work begins (e.g., migrations must succeed before seeding)

**Examples**:
- Two phases of 2 tasks each, no shared files → merge into one phase of 4 tasks in 2 waves
- Phase 1 creates a new module, Phase 2 imports it → keep separate (producer/consumer dependency)
- Phase 1 has 5 tasks, Phase 2 has 1 task → keep separate (Phase 1 already at max)

---

## WORKTREE PATH (Steps 7-11)

### 7. Create plan

1. Use `<name>` from Step 1b as the worktree name (refine if the plan title suggests a better name).
2. **Setup worktree** (with optional satellites and sparse-checkout):
   - If the user selected sibling repos as satellites during Step 3, include them in the plan as `<secondary-repos>` entries (name + relative path from the "## Sibling Repos" section of map-project.ts output).
   - If the plan includes `<secondary-repos>`, parse it and build a JSON array: `[{"name": "<name>", "path": "<relative-path>"}, ...]`
   - **Derive sparse paths** (optional optimization): Extract unique top-level directories from `<relevant-files>` and `<new-files>` entries (e.g., `src/components/Foo.tsx` → `src`, `hooks/bar.ts` → `hooks`). Join as comma-separated string. Sparse-checkout is an optional optimization. If the plan references more than 10 top-level directories, skip `--sparse-paths` to use full checkout.
   - With satellites and sparse paths: Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name> --secondary '<json>' --sparse-paths '<dirs>'`
   - With satellites, no sparse: Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name> --secondary '<json>'`
   - With sparse paths, no satellites: Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name> --sparse-paths '<dirs>'`
   - No satellites, no sparse: Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name>`
   - Parse the JSON output to get `worktreePath`. If `sparsePaths` is present, log the sparse-checkout paths. If `satellites` is present in output, report each satellite worktree path and any warnings.
3. Write the plan to `<worktreePath>/.devorch/plans/current.md` following the **Plan Format** below.
4. Copy `.devorch/CONVENTIONS.md` to `<worktreePath>/.devorch/CONVENTIONS.md` (if it exists or was just generated).
5. Do NOT copy `explore-cache-<name>.md` — it stays in the main repo. Worktrees read cache from main via `--cache-root`.
6. Set `planPath = <worktreePath>/.devorch/plans/current.md` for subsequent steps.

### 8. Validate

Run `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <planPath>`. Fix issues if blocked.

### 9. Reset state

Delete `<worktreePath>/.devorch/state.md` if it exists.

A new plan means fresh state. Previous plan's progress is irrelevant.

### 10. Commit

Commit in the worktree's branch:
```bash
git -C <worktreePath> add .devorch/plans/current.md .devorch/CONVENTIONS.md
git -C <worktreePath> commit -m "chore(devorch): plan — <descriptive plan name>"
```

Also commit any devorch files changed in the main repo (explore-cache, CONVENTIONS.md):
- Stage `.devorch/explore-cache-<name>.md`, `.devorch/CONVENTIONS.md` (if created/updated)
- Format: `chore(devorch): add worktree for <plan name>`

### 11. Suggest next

Report:
```
Plano criado na worktree: <worktreePath> (branch: <branch>)
/clear
/devorch:build --plan <name>
```
Explain: planning consumed significant context — `/clear` frees it before build starts.

---

## INLINE PATH (Steps 7i-10i)

### 7i. Create plan in worktree

1. Record the current branch: `git branch --show-current` → store as `originalBranch`. Set `mainRoot` = current working directory.
2. **Derive sparse paths** (optional optimization): Extract unique top-level directories from `<relevant-files>` and `<new-files>` entries (e.g., `src/components/Foo.tsx` → `src`, `hooks/bar.ts` → `hooks`). Join as comma-separated string. If the plan references more than 10 top-level directories, skip `--sparse-paths` to use full checkout.
3. **Setup worktree**:
   - With sparse paths: Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name> --sparse-paths '<dirs>'`
   - No sparse: Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name>`
   - Parse the JSON output to get `worktreePath`. If `sparsePaths` is present, log the sparse-checkout paths.
4. Write the plan to `<worktreePath>/.devorch/plans/current.md` following the **Plan Format** below.
5. Copy `.devorch/CONVENTIONS.md` to `<worktreePath>/.devorch/CONVENTIONS.md` (if it exists or was just generated).
6. Do NOT copy `explore-cache-<name>.md` — it stays in the main repo. Worktrees read cache from main via `--cache-root`.
7. Validate: `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <worktreePath>/.devorch/plans/current.md`. Fix if blocked.
8. Delete `<worktreePath>/.devorch/state.md` if it exists.
9. Commit plan in worktree:
   ```bash
   git -C <worktreePath> add .devorch/plans/current.md .devorch/CONVENTIONS.md
   git -C <worktreePath> commit -m "chore(devorch): plan — <descriptive plan name>"
   ```
10. Also commit any devorch files changed in the main repo (explore-cache, CONVENTIONS.md):
    - Stage `.devorch/explore-cache-<name>.md`, `.devorch/CONVENTIONS.md` (if created/updated)
    - Format: `chore(devorch): add inline worktree for <plan name>`
11. Set `projectRoot = <worktreePath>`, `planPath = <worktreePath>/.devorch/plans/current.md`.

All `git` and `bun` commands in subsequent steps must run with `cwd` set to `<projectRoot>` (or use `git -C <projectRoot>`).

### 8i. Phase loop

For each phase N sequentially:

#### (a) Init phase

Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N --cache-root <mainRoot> --cache-name <name>`.

Parse JSON output. If `contentFile` field is present, read that file for full phase context. Otherwise use the `content` field directly.

#### (b) Deploy builders

For each wave, launch builders as foreground parallel Agent calls (`subagent_type="devorch-builder"`). Each builder receives:
- `Working directory: <projectRoot>`
- `All file operations and git commands must use this directory as root`
- Plan **Objective**, **Solution Approach** (if present), **Decisions** (if present) — from init output
- Full task details from the `tasks` map
- Convention sections from `conventionsByTask[taskId]`
- Cache sections from `cacheByTask[taskId]`
- **Effort guidance**: "Execute focused implementation. You have a clear spec — prioritize writing correct code over extensive exploration. If you encounter unexpected complexity, use Explore agents rather than reasoning through unknowns."
- `commit with type(scope): description`
- `CRITICAL: call TaskUpdate with status "completed" as your very last action`

After all builders in a wave return, verify via `TaskList` that every task is marked completed.

**On builder failure** (task not marked completed after Task call returned, or no matching commit in `git log`):
- **First failure (0 retries)**: Use the Task result output to diagnose the issue. Re-launch the task with an additional note describing the previous failure. Increment retry counter.
- **After 1 retry**: Stop and report the failure. Do not retry further.

#### (c) Validate phase code

**Single-phase plans**: If `totalPhases == 1`, skip per-phase check entirely — the final check in step 9i covers everything. Proceed directly to (d).

**Multi-phase plans** (`totalPhases > 1`): Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`. The `--quick` flag runs only build and typecheck (lint and test are skipped).
- If build or typecheck fail: fix ALL errors. If unable to fix after one retry, stop and report.
- If everything passes: proceed.

#### (d) Phase summary and commit

Run `bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan <planPath> --phase N --status "ready for phase $((N+1))" --summary "<concise phase summary>"`.

If changes exist (`git -C <projectRoot> status --porcelain`), commit with the generated message.

#### (e) Cache management

Run `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000 --root <mainRoot> --cache-name <name>`.

### 9i. Final verification

Determine changed files: `git -C <projectRoot> diff --name-only <originalBranch>...HEAD`.

**Residual scan** (quick, no file reading):

Use the Grep tool to search for `TODO|FIXME|HACK|XXX` across the changed files (using `<projectRoot>` as base path). Record any findings with file:line evidence.

**Adversarial review agents** — scale by plan size:

Count total tasks across all phases. Launch reviewers as foreground parallel Agent calls (`subagent_type="Explore"`), all in a single message:

- **1-2 tasks** → **1 combined reviewer** (security + quality + completeness + cross-phase integration in one prompt)
- **3-5 tasks** → **2 reviewers**: security-reviewer + quality-completeness-reviewer (quality, completeness, and cross-phase integration combined)
- **6+ tasks** → **3 reviewers**: security-reviewer + quality-reviewer + completeness-reviewer

Each reviewer receives: `Working directory: <projectRoot>`, plan objective, CONVENTIONS.md content, list of changed files. Reviewer mandates:
- **security-reviewer**: vulnerabilities, injection risks, auth issues, data exposure, secrets
- **quality-reviewer**: edge cases, error handling, correctness, maintainability
- **completeness-reviewer**: everything from the plan was implemented? anything missing? behavior matches spec? Cross-phase integration — imports resolve, no orphan exports, handoff contracts honored, type consistency across modules

**Fix findings**:
- **Trivial** (1-2 files, fix is self-evident): fix directly with Edit tool.
- **Fix-level** (well-defined fix, 3+ files or non-trivial logic): launch devorch-builder agents (`subagent_type="devorch-builder"`) as foreground calls. Include `Working directory: <projectRoot>` in builder prompt.
- **Talk-level** (requires design decisions): do NOT fix, report as pending issue.

**Skip-on-zero-findings**: If all reviewers AND the residual scan report zero findings, skip fix execution AND post-review check entirely.

**Post-review check**: Determine intensity based on fix tiers:
- **Trivial fixes only**: `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`
- **Fix-level fixes**: `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot>` (full)
- If all checks pass: proceed to 10i.
- If any check fails: diagnose and retry once. If retry fails, proceed to 10i with FAIL verdict.

### 10i. Merge and cleanup

All merge operations in this step run from `<mainRoot>` (the main repo), not `<projectRoot>` (the worktree).

**On SUCCESS** (all checks pass, no talk-level issues):

1. **Pre-flight stash**: Run `git -C <mainRoot> status --porcelain` and filter out lines starting with `??` (untracked files). If any tracked changes remain:
   ```bash
   git -C <mainRoot> stash push -m "devorch-pre-merge"
   ```
   Record that the repo was stashed. If no tracked changes exist, skip stash and record as clean.

2. **Dry-run merge**:
   ```bash
   git -C <mainRoot> merge --no-commit --no-ff devorch/<name>
   git -C <mainRoot> merge --abort
   ```
   If dry-run fails and the repo was stashed: run `git -C <mainRoot> stash pop` to restore changes. Report the conflict between branches and stop.

3. **Merge**:
   ```bash
   git -C <mainRoot> checkout <originalBranch>
   git -C <mainRoot> merge devorch/<name>
   ```

4. **Restore stash**: If the repo was stashed:
   ```bash
   git -C <mainRoot> stash pop
   ```
   If `stash pop` fails (exit code != 0): run `git -C <mainRoot> status --porcelain` to list conflicting files. Report to the user: "Stash pop conflict: `<file list>`. Resolve manually with `git mergetool` or edit the files, then `git add` and `git stash drop`." Stop — do NOT continue cleanup.

5. **Fix migration journal** (Drizzle projects only):
   Run `bun $CLAUDE_HOME/devorch-scripts/fix-migration-journal.ts --root <mainRoot>`. If `fixed > 0`, the journal was corrected — include the journal file in the cleanup commit. This prevents silent migration skips when worktrees generate migrations with out-of-order timestamps.

6. **Post-merge cleanup**:
   - Run `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan <worktreePath>/.devorch/plans/current.md` to archive the plan.
   - Delete `.devorch/state.md` from the main repo if it exists.
   - Delete `.devorch/explore-cache-<name>.md` from the main repo if it exists. Also delete `.devorch/explore-cache.md` if it exists (backward compat cleanup).
   - Delete `.devorch/project-map.md` from the main repo if it exists.
   - Run `git -C <mainRoot> status --porcelain .devorch/`. If there are changes, commit: `chore(devorch): cleanup post-merge <plan name>`

7. **Remove worktree**:
   ```bash
   git -C <mainRoot> worktree remove <projectRoot>
   git -C <mainRoot> branch -d devorch/<name>
   ```

8. Report verdict using the same format as build command step 3d:
   ```
   ## Verificação Final: <plan name>

   ### Residual Scan
   <TODO/FIXME findings ou "✅ clean">

   ### Review Adversarial
   Security: <findings ou "✅ clean">
   Quality: <findings ou "✅ clean">
   Completeness: <findings ou "✅ clean">

   ### Correções de Review
   <N issues corrigidos inline, M via builder agents> (ou "Nenhum")

   ### Post-Review Check
   Lint: ✅/❌  Typecheck: ✅/❌  Build: ✅/❌  Tests: ✅/❌ (N/M)

   ### Issues Pendentes
   <prompts /devorch:talk gerados> (ou "Nenhum")

   ### Verdict: PASS / PASS com N issues pendentes / FAIL
   ```

   Report: "Merged `devorch/<name>` into `<originalBranch>`. Worktree removed."

**On FAILURE** (check failures, unresolvable issues):

Do NOT merge. Do NOT remove worktree. Report:
```
Build inline falhou na fase N. Worktree `<projectRoot>` preservada (branch `devorch/<name>`) com M commits.
```
Suggest: `/devorch:fix` to address remaining issues, or `/devorch:build --plan <name>` to retry in a new session.

---

## Parallelization Rules

Maximize parallel execution without losing quality:

- **Break work into independent units.** If a large task can be split into two tasks that touch different files, split it.
- **Group independent tasks into the same wave.** All tasks in a wave run as parallel agents.
- **Only create sequential waves when truly necessary**: task B reads output of task A, or both modify the same file.
- **Aim for wide waves**: 3 parallel tasks in 1 wave is better than 3 sequential waves of 1 task.
- **Wider waves in fewer phases > narrow waves across many phases**: A single phase with a 4-task wave completes faster than two phases with 2-task waves each, due to per-phase overhead (init, check, summary). Consolidate when tasks are independent.

Quality guardrails:
- Two tasks in the same wave must NOT modify the same file.
- Two tasks in the same wave must NOT have a producer/consumer relationship.
- Each task must be self-contained — a builder should complete it without needing another builder's uncommitted work.

## Sizing Rules

- Max **5 tasks** per phase. Tasks can span multiple related files when the changes are cohesive. Each completable by one builder.
- Each phase MUST fit in 1 phase execution without context compaction.
- Prefer fewer phases with well-scoped tasks. Each builder now has ample context (1M tokens) — use it by including more relevant explore-cache and conventions per task.
- Include ALL relevant explore-cache sections for each task, not just the minimum. Builders benefit from broader context when it's fresh and focused.
- **Minimize phase count**: With 1M context, the orchestrator handles phases inline — each additional phase adds ~2-3 min overhead (init + check + summary). Consolidate adjacent phases when safe (see Phase consolidation guidance in Step 6). A 2-phase plan that takes 10 min is better than a 4-phase plan that takes 18 min for the same work.

## Plan Format

Plans use XML tags for structure. The format below is the **complete specification**.

```xml
# Plan: <descriptive name>

<description>
<what we're building/changing>
</description>

<objective>
<measurable goal — what's true when this plan is complete>
</objective>

<classification>
Type: <type>
Complexity: <complexity>
Risk: <risk>
</classification>

<decisions>
<user choices from the clarification step — each as a one-line "Question → Answer" pair>
<include ALL user answers that affect implementation, even if they seem obvious>
</decisions>

<!-- if medium or complex: -->
<problem-statement>
<specific problem or opportunity>
</problem-statement>

<solution-approach>
<approach, alternatives considered, rationale>
</solution-approach>
<!-- end if -->

<relevant-files>
- `path/to/file` — why it's relevant

<new-files>
- `path/to/new/file` — what it is
</new-files>

<!-- optional — only when plan involves multiple repos: -->
<secondary-repos>
- `name` — relative/path/to/repo
</secondary-repos>
</relevant-files>

<phase1 name="Name">
<goal>one sentence</goal>

<spec>
<interface name="unique-name">
  <input>parameter descriptions with types</input>
  <output>return value description with types</output>
  <error case="error-name">expected behavior</error>
</interface>
<error-contract name="unique-name">
  <case trigger="condition" handling="expected behavior" />
</error-contract>
<behavior name="unique-name">
  <precondition>what must be true before</precondition>
  <postcondition>what must be true after</postcondition>
</behavior>
<invariant>condition that must always hold</invariant>
<endpoint path="/path" method="METHOD">
  <request>schema or description</request>
  <response status="NNN">schema or description</response>
</endpoint>
</spec>

<tasks>
#### 1. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- **Repo**: <name> <!-- optional, default: primary. Use secondary repo name when task targets a satellite repo -->
- **Spec refs**: <comma-separated spec names from phase <spec> section> <!-- optional -->
- <specific action>
- <specific action>

#### 2. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- **Spec refs**: <comma-separated spec names> <!-- optional -->
- <specific action>

</tasks>

<execution>
**Wave 1** (parallel): <task-id-a>, <task-id-b>
**Wave 2** (after wave 1): <task-id-c>
</execution>

<criteria>
- [ ] <measurable criterion>
</criteria>

<handoff>
<what next phase needs to know>
(required for all phases except the last)
</handoff>
</phase1>

<phase2 name="Name">
<!-- same structure -->
</phase2>
```

### Plan Format Rules

- Tags used at top-level: `<description>`, `<objective>`, `<classification>`, `<decisions>`, `<problem-statement>` (medium/complex), `<solution-approach>` (medium/complex), `<relevant-files>`, `<new-files>` (nested in relevant-files), `<secondary-repos>` (nested in relevant-files, optional — multi-repo plans only)
- Phase tags: `<phaseN name="...">` where N is sequential integer
- Inside phase: `<goal>`, `<spec>`, `<tasks>`, `<execution>`, `<criteria>`, `<handoff>` (except last phase)
- Inside spec: `<interface name>`, `<error-contract name>`, `<behavior name>`, `<invariant>`, `<endpoint path method>`. All names must be unique within a phase.
- Task fields: `**ID**` (required), `**Assigned To**` (required), `**Repo**` (optional — default: primary; set to secondary repo name when task targets a satellite repo), `**Spec refs**` (optional — comma-separated spec names from the phase `<spec>` section)

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING AND ROUTING ONLY.** Do not build, write code, or deploy builder agents (except during INLINE PATH execution).
- **The orchestrator NEVER reads source code files directly** (except for applying trivial fixes during INLINE PATH step 9i review). Use the Agent tool with `subagent_type="Explore"` for all codebase exploration. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches, residual scans). **Rationale**: orchestrators that read source files directly consume context that should remain free for planning, clarification rounds, and plan generation. Explore agents run in isolated context windows, so their work costs zero tokens in the orchestrator's window.
- **Explore agents focus on source code.** Devorch state files (`.devorch/*`) are read by the orchestrator, not by Explore agents. This keeps agent prompts focused and avoids conflicting reads.
- Always validate the plan before reporting.
- Create `.devorch/plans/` directory if needed.
- **Language policy**: User-facing output (questions, reports, summaries, progress messages) in Portuguese pt-BR with correct accentuation (e.g., "não", "ação", "é", "código", "será"). Code, git commits, internal files, and technical documentation in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese text.
- No agents except Explore (for understanding code) and devorch-builder (for INLINE PATH execution only).
- **Inline builds are single-repo only.** Plans with `<secondary-repos>` always use the worktree path.
- **Output format**: All output to the user must be plain text in the chat. Never use ASCII art, box-drawing characters, or decorative diagrams. Use markdown formatting (headers, lists, bold, code blocks) for structure.
