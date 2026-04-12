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

- **If missing** (first-time generation): Run `bun $CLAUDE_HOME/devorch-scripts/map-conventions.ts <project-root>`. Write the output to `.devorch/CONVENTIONS.md`. Then launch 1 Explore agent (`subagent_type="Explore"`, `model="sonnet"`, thoroughness "quick") to enrich with semantic context the script cannot capture: architectural patterns rationale, active workaround explanations, non-obvious gotchas. Merge the Explore findings into the generated CONVENTIONS.md. Run `bun $CLAUDE_HOME/devorch-scripts/check-conventions-staleness.ts --update` to save initial hashes.

- **If exists**: Run `bun $CLAUDE_HOME/devorch-scripts/check-conventions-staleness.ts`. Parse the JSON output. If `stale` is `false` → skip regeneration, use the existing CONVENTIONS.md as-is. If `stale` is `true` → regenerate: run `bun $CLAUDE_HOME/devorch-scripts/map-conventions.ts <project-root>`, overwrite `.devorch/CONVENTIONS.md` with the output (no Explore agents for staleness regeneration), then run `bun $CLAUDE_HOME/devorch-scripts/check-conventions-staleness.ts --update` to save the new hashes.

**Legacy plan migration**: If `.devorch/plans/current.md` exists in the main repo, archive it silently: run `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan .devorch/plans/current.md`. Report: "Migrated legacy plan to archive." Plans now always live in worktrees — this path only triggers once during migration.

**Stale cache cleanup**: Delete any `.devorch/explore-cache-*.md` files older than 7 days.

### 1b. Derive plan name

Derive a preliminary kebab-case name from $ARGUMENTS (3-5 descriptive words, lowercase, hyphenated). This name is used for: explore cache file, branch name (inline builds), and worktree name (worktree builds). The name may be refined later when the plan title is finalized — if so, rename the cache file accordingly (e.g., `mv .devorch/explore-cache-<old-name>.md .devorch/explore-cache-<new-name>.md`).

Store this as `<name>` for all subsequent steps.

### 2. Explore

**Fast-path condition**: If $ARGUMENTS contains ALL of: (1) specific file path references, (2) an explicit action (fix, change, update, rename, add, remove), and (3) sufficient context to implement without discovery — reduce this step to 1 Explore agent at "medium" thoroughness (not "very thorough") with a single combined focus. Also reduce Step 3 (Clarify) to 1 confirmative round. Otherwise, proceed with the standard exploration below.

**Standard exploration**: Analyze $ARGUMENTS and determine 2-3 distinct exploration focuses relevant to the task. Consider: architecture/integration, risks/edge cases, existing patterns/conventions.

Launch 2-3 Explore agents (Agent tool with `subagent_type="Explore"`, `model="sonnet"`) in parallel in a single message. Each agent receives: a specific focus area (distinct from other agents), $ARGUMENTS, CONVENTIONS.md content (if it exists). Use thoroughness "very thorough" for the primary exploration.

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

**High-confidence recommendations.** When the exploration provides clear evidence for an approach, present it as a RECOMMENDATION with opt-out (e.g., 'Recomendo X por causa de Y. Concordas?') instead of an open question. Reserve open questions for genuinely ambiguous decisions where exploration provides no clear basis to recommend.

**Reflection pass (after all rounds complete).** Before moving on, step back and review the full picture: the original request, exploration findings, and all user answers so far. Consider what the user might want but didn't explicitly ask for — common causes:
- **Short or vague prompt** — the user had a clear mental picture but described only part of it.
- **Assumed obvious** — features or behaviors the user takes for granted but never stated (e.g., error feedback, loading states, undo, accessibility, mobile responsiveness).
- **Adjacent functionality** — things that naturally complement the request (e.g., user asked for "create" but probably also needs "edit" and "delete"; asked for an API endpoint but probably needs validation and error responses).
- **Operational concerns** — logging, monitoring, rollback, migration path, performance under load.
- **Things the exploration revealed** that the user likely doesn't know about (hidden dependencies, undocumented constraints, patterns the codebase already follows that affect this work).

If this reflection surfaces new questions or suggestions, present them in a final `AskUserQuestion` round framed as: "Revisando tudo que discutimos, pensei em mais algumas coisas que podem ser relevantes:" — with options including "Já está bom, seguir em frente" as the last choice. If nothing new surfaces, proceed silently.

### 4. Deep exploration (conditional)

If user answers revealed new areas to explore, launch additional Explore agents targeted by the user's choices. Append findings to `.devorch/explore-cache-<name>.md`.

Use the Agent tool with `subagent_type="Explore"`, `model="sonnet"` for all codebase exploration. **Do NOT read source files directly** — use Explore agent summaries as your evidence base. Use Grep directly only for quantification (counting imports, usage patterns).

**Evidence-based planning**: every task must reference real files discovered by Explore agents, not assumptions. Quantify: "Update 14 files that import from X", not "Update files".

### 5. Propose plan

Count total tasks across all phases in the designed plan. Show summary: "Plano: N fases, M tasks, K waves."

**Display specs within the plan**: Include the drafted spec contracts for each phase inline with the plan summary. Group specs by phase using markdown headers and code blocks. The user approves plan + specs together in a single confirmation — no separate spec approval round.

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

**Spec drafting**: Design `<spec>` contracts as part of the solution. Each phase should have specs that define the contracts builders must implement. Prefer fewer, more precise specs over many vague ones. Ground specs in what the exploration found — reference real files, patterns, or constraints discovered. Don't spec what the codebase or conventions already define. Don't spec pure implementation details the builder is better equipped to decide. Include concrete examples derived from the exploration (real function names, real error cases discovered). These specs will be displayed within the plan proposal (Step 5) for unified approval.

When the design identifies areas that will need deeper exploration during build (complex modules the builder hasn't seen, third-party API patterns), add `<explore-queries>` to the relevant phase with directed queries targeting specific knowledge artifacts.

### 6b. Devil's Advocate (automatic)

After the solution design is complete, launch an adversarial challenge to surface risks before committing to a plan.

**DA auto-skip**: Before launching the DA agent, check: if `(complexity == "simple") OR (risk == "low" AND total tasks across all phases ≤ 3)` → skip the DA, log "DA skipped — simple plan" or "DA skipped — low-risk plan with ≤3 tasks" (as appropriate), and proceed directly to Step 7 (or Step 7i for inline path). **Exception**: plans with `<secondary-repos>` always get DA regardless of classification. If the skip condition does not hold → run DA normally as described below.

**Launch**: 1 Explore agent (Agent tool with `subagent_type="Explore"`, thoroughness "very thorough") with adversarial mandate. The agent receives:
- Solution approach from Step 6
- Proposed specs from Step 6
- `<relevant-files>` list from the emerging plan
- Explore-cache content from `.devorch/explore-cache-<name>.md`
- CONVENTIONS.md content (if exists)

**Agent mandate**: Investigate and report structured findings in exactly 4 categories:
- **Implicit assumptions** — design takes for granted things that may not hold
- **Wave/task conflicts** — shared file risks, hidden dependencies between parallel tasks
- **Spec gaps** — missing error cases, undefined edge behaviors, incomplete contracts
- **Regression risks** — existing functionality that may break, with file evidence

**Explore-cache constraint**: The DA must NOT contradict findings from the explore-cache without NEW code evidence not present in the cache. Findings confirmed by explore-cache with file evidence are established facts — accept them and focus on risks NOT already covered by the exploration. Before reporting a finding, verify it is not already confirmed or refuted by the explore-cache.

**On no findings**: If the agent finds no significant issues in any category, report "No significant issues found" and proceed automatically to Step 7 (no user prompt needed). Do not fabricate findings.

**On findings**: Display as structured report in chat using plain markdown (headers, lists, bold — no box-drawing):

```
### Devil's Advocate — Findings

**Implicit Assumptions**
- <finding or "None">

**Wave/Task Conflicts**
- <finding or "None">

**Spec Gaps**
- <finding or "None">

**Regression Risks**
- <finding or "None">
```

Then use `AskUserQuestion` with options:
- "Ajustar design" — return to Step 6 with DA findings as additional input context
- "Ignorar — seguir" — proceed to Step 7
- "Cancelar" — stop the talk session

**Routing:**
- "Ajustar design" → return to Step 6. Include the DA findings as explicit constraints/considerations in the redesign pass.
- "Ignorar — seguir" → proceed to Step 7 (or Step 7i for inline path).
- "Cancelar" → report "Sessão cancelada pelo usuário após Devil's Advocate." and stop.

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

When splitting a task creates additional tasks that fit in the same wave without file conflicts, consolidation into the same phase adds zero overhead — only phase boundaries (not wave boundaries) incur pipeline overhead.

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
3. Write the plan to `<worktreePath>/.devorch/plans/<name>.md` following the **Plan Format** below.
4. Copy `.devorch/CONVENTIONS.md` to `<worktreePath>/.devorch/CONVENTIONS.md` (if it exists or was just generated).
5. Do NOT copy `explore-cache-<name>.md` — it stays in the main repo. Worktrees read cache from main via `--cache-root`.
6. Set `planPath = <worktreePath>/.devorch/plans/<name>.md` for subsequent steps.

### 8. Validate

Run `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <planPath>`. Fix issues if blocked.

### 9. Reset state

Delete `<worktreePath>/.devorch/state.md` if it exists.

A new plan means fresh state. Previous plan's progress is irrelevant.

### 10. Commit

Commit in the worktree's branch:
```bash
git -C <worktreePath> add .devorch/plans/<name>.md .devorch/CONVENTIONS.md
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
4. Write the plan to `<worktreePath>/.devorch/plans/<name>.md` following the **Plan Format** below.
5. Copy `.devorch/CONVENTIONS.md` to `<worktreePath>/.devorch/CONVENTIONS.md` (if it exists or was just generated).
6. Do NOT copy `explore-cache-<name>.md` — it stays in the main repo. Worktrees read cache from main via `--cache-root`.
7. Validate: `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <worktreePath>/.devorch/plans/<name>.md`. Fix if blocked.
8. Delete `<worktreePath>/.devorch/state.md` if it exists.
9. Commit plan in worktree:
   ```bash
   git -C <worktreePath> add .devorch/plans/<name>.md .devorch/CONVENTIONS.md
   git -C <worktreePath> commit -m "chore(devorch): plan — <descriptive plan name>"
   ```
10. Also commit any devorch files changed in the main repo (explore-cache, CONVENTIONS.md):
    - Stage `.devorch/explore-cache-<name>.md`, `.devorch/CONVENTIONS.md` (if created/updated)
    - Format: `chore(devorch): add inline worktree for <plan name>`
11. Set `projectRoot = <worktreePath>`, `planPath = <worktreePath>/.devorch/plans/<name>.md`.

All `git` and `bun` commands in subsequent steps must run with `cwd` set to `<projectRoot>` (or use `git -C <projectRoot>`).

### 8i. Phase loop

For each phase N sequentially:

#### (a) Init phase

Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N --cache-root <mainRoot> --cache-name <name>`.

Parse JSON output. If `contentFile` field is present, read that file for full phase context. Otherwise use the `content` field directly.

#### (b) Deploy builders

**Cache coverage check**: If the init-phase JSON output contains `cacheCoversPhase: true` → skip explore agents for this phase, log "Cache covers phase N — skipping explore". If `cacheCoversPhase` is `false` → check the `uncoveredFiles` array from init-phase output. If the phase has `<explore-queries>`, the orchestrator evaluates whether `uncoveredFiles` overlap with the queries' targets and decides whether explore is needed. If no explore-queries exist and cache does not cover the phase, let builders use Explore agents as needed.

For each wave, launch builders as foreground parallel Agent calls. Use per-task model and effort from the `tasks` map:

- **`subagent_type`**: If `task.effort == "high"`, use `"devorch-builder-deep"`. Otherwise use `"devorch-builder"`.
- **`model` override**: If `task.model` is set, pass it as the `model` parameter in the Agent call. Otherwise omit (defaults to `opus`).

Each builder receives:
- `Working directory: <projectRoot>`
- `All file operations and git commands must use this directory as root`
- Plan **Objective**, **Solution Approach** (if present), **Decisions** (if present) — from init output
- Full task details from the `tasks` map
- Convention sections: read `conventions` (full string) from init-phase JSON root and `conventionSectionsByTask[taskId]` (array of section header names). If the array is empty or missing for the task, inject the full `conventions` text. Otherwise, split `conventions` by `## ` headers, match section names from the array, extract matching sections with their content, join them, and inject the result.
- Spec contracts from `specsByTask[taskId]`
- Code structure from `codeStructureByTask[taskId]` (if non-empty)
- Cache sections from `cacheByTask[taskId]`
- **Effort guidance**: "Execute focused implementation. You have a clear spec — prioritize writing correct code over extensive exploration. If you encounter unexpected complexity, use Explore agents rather than reasoning through unknowns."
- **Spec verification instruction**: "Verify your implementation satisfies all spec contracts before committing. Check: function signatures match `<interface>` specs, error handling matches `<error-contract>` cases, pre/postconditions from `<behavior>` specs are honored."
- `commit with type(scope): description`
- `CRITICAL: call TaskUpdate with status "completed" as your very last action`

After all builders in a wave return, verify via `TaskList` that every task is marked completed.

**Build Report extraction** — After verifying task completion for a wave, extract the `## Build Report` block from each completed builder's text output (the text returned by the Task/Agent call):
- Use regex: from `## Build Report` to the next `##` header or end of text.
- If no `## Build Report` is found in a builder's output, skip silently (backward compatible with older builders).
- Store the parsed report content keyed by task-id for aggregation in the final verification report (step 10i).

**Per-task contract verification** — After Build Report extraction, check the plan classification. If `complexity == "simple" AND risk == "low"`, skip the entire verification block and log: "Contract verification skipped — simple/low plan". Otherwise, verify each completed task's implementation against its spec contracts:

1. For each completed task in the wave, check if the task body (from `tasks[taskId]` in init-phase output) contains an explicit `**Spec refs**:` field with a non-empty value. If absent or empty, log "No explicit spec refs for `<taskId>` — skipping contract verification" and skip to the next task.
2. Find the builder's commit hash: run `git -C <projectRoot> log --oneline --format="%H %s" -20` and search for a commit message containing the task ID. Extract the hash. If no match found, log "No commit found for task `<taskId>` — skipping contract verification" and skip.
3. Extract the diff: `git -C <projectRoot> show <commit-hash>` (full diff including stat).
4. Launch a verification agent (`subagent_type="Explore"`, `model="sonnet"`) with a prompt that includes the exact verifier template below, followed by the git diff and spec contracts text from `specsByTask[taskId]`:

```
You are a contract verifier. Given a git diff and spec contracts, check whether the implementation satisfies each spec element.

For each spec element (interface, error-contract, behavior, invariant, endpoint):
1. Find the relevant changes in the diff
2. Check if the implementation matches the spec requirements
3. Report PASS or VIOLATION with specifics

Output format (EXACTLY this structure):
VERDICT: PASS | VIOLATION
- <spec-name>: PASS | VIOLATION — <one-line details if violation>
```

5. Parse the verifier output: search for the line starting with `VERDICT:` — extract `PASS` or `VIOLATION`.
6. On **PASS**: log "Contract verification PASS for `<taskId>`" and continue to the next task.
7. On **VIOLATION**: run `git -C <projectRoot> revert --no-commit <commit-hash>` then `git -C <projectRoot> reset HEAD`. Re-launch the builder with the original task context plus an appended section:
   ```
   ## Contract Violation
   The following spec violations were found in your previous implementation:
   <verifier output>
   Fix all violations listed above.
   ```
   This counts as a retry — increment the existing per-task retry counter. If 3 retries are exhausted, stop the phase with the same structured failure format described below.

**On builder failure** (task not marked completed after Task call returned, or no matching commit in `git log`):

Track retries **per task ID** (not per wave). Each task has an independent retry counter starting at 0, max 3 retries.

For each retry (up to 3):
1. **Extract error context** from the failed builder's Task result output: capture the **last 50 lines** of output as the error message.
2. **Extract git diff** of changes made by the failed builder: run `git -C <projectRoot> diff HEAD~1` if the builder made any commits (check `git log --oneline -1` for a commit matching the task). If no commits were made, note "No commits from failed attempt."
3. **Re-launch the builder** with the original task context unchanged, plus an additional `## Previous Failure Context` section appended to the prompt containing:
   - `Retry attempt: N of 3`
   - `Error from previous attempt (last 50 lines):` followed by the captured error output
   - `Git diff from failed attempt:` followed by the diff (or "No commits from failed attempt")
   - `Instruction: Analyze the error above. Fix the root cause — do not repeat the same approach if it failed.`
4. Increment the retry counter for this task ID.

**After 3 retries exhausted**: Stop the entire phase. Report structured failure:
```
### Task Failure: <task-id>
**Retries exhausted**: 3/3

#### Error Timeline
1. **Attempt 1**: <error summary>
2. **Attempt 2**: <error summary>
3. **Attempt 3**: <error summary>

#### Last Git Diff
<diff from last attempt or "No commits">

#### Suggestion
<what might fix the issue>
```
Do not continue to the next wave or phase.

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
- **Fix-level** (well-defined fix, 3+ files or non-trivial logic): launch devorch-builder agents (`subagent_type="devorch-builder-deep"`) as foreground calls — fix-level builders always use high effort. Include `Working directory: <projectRoot>` in builder prompt.
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

1. **Merge via script**: Run:
   ```bash
   bun $CLAUDE_HOME/devorch-scripts/merge-worktree.ts --worktree-path <projectRoot> --main-root <mainRoot> --original-branch <originalBranch> --branch-name devorch/<name>
   ```
   Parse the JSON output. Route by `status`:
   - **`"success"`**: Report merged repos from `mergedRepos`. If `selfBuildNeeded` is `true` AND `<mainRoot>/install.ts` exists: log "devorch scripts updated — running install" and run `bun run install` in `<mainRoot>`.
   - **`"conflict"`**: Report conflict in `conflictRepo` with files from `conflictFiles`. Stop — do NOT continue.
   - **`"stash-conflict"`**: Report conflicting files from `conflictFiles`. Instruct user: "Resolve manually with `git mergetool` or edit the files, then `git add` and `git stash drop`." Stop — do NOT continue.
   - **`"error"`**: Report `error` message. Stop — do NOT continue.

2. Report verdict using the same format as build command step 3d:
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

   ### Builder Reports
   <For each task-id with non-trivial fields, list: **<task-id>**: <field>: <value> (one line per non-trivial field). Non-trivial = values that are NOT "none" and NOT "adequate". If ALL builders reported only "none"/"adequate" for all fields, omit this section entirely.>

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
- **1 task = 1 responsibility** — a task should address one cohesive concern. "Cohesive" means single responsibility: one logical change, one module boundary, one spec contract family. When in doubt, split.
  - Recommend splitting when a task's **Spec refs** point to specs operating on clearly different components or modules (semantic judgment by the planner, not a computable rule).
  - When a task is classified `opus`/`high` and the complexity comes from volume rather than reasoning depth, consider splitting into 2 tasks at `sonnet`/`medium` IF the resulting tasks are parallelizable (no producer/consumer dependency).
  - Prefer wider waves with focused tasks over narrower waves with complex tasks — 4 focused tasks in 1 parallel wave beats 2 complex tasks in 1 wave.
- Each phase MUST fit in 1 phase execution without context compaction.
- Prefer fewer phases with well-scoped tasks. Each builder now has ample context (1M tokens) — use it by including more relevant explore-cache and conventions per task.
- Include ALL relevant explore-cache sections for each task, not just the minimum. Builders benefit from broader context when it's fresh and focused.
- **Minimize phase count**: With 1M context, the orchestrator handles phases inline — each additional phase adds ~2-3 min overhead (init + check + summary). Consolidate adjacent phases when safe (see Phase consolidation guidance in Step 6). A 2-phase plan that takes 10 min is better than a 4-phase plan that takes 18 min for the same work.

## Per-Task Model & Effort Classification

Each task can optionally specify `**Model**` and `**Effort**` to optimize cost and speed without losing quality. **Both fields are optional** — when omitted, defaults are `opus` / `medium`.

### Classification rules

Classify each task based on its complexity, risk, and type:

| Task characteristics | Model | Effort | Examples |
|---|---|---|---|
| Simple edits: docs, config, renaming, copy changes | sonnet | low | Update README, change env var names, adjust config values |
| Straightforward implementation with clear spec, 1-3 files | sonnet | medium | Add a new route handler following existing pattern, create a simple component |
| Implementation with clear spec, moderate complexity, following existing patterns | sonnet | medium | Implement a service with 2-3 methods following existing pattern, wire up a new module, CRUD endpoints |
| Implementation with moderate complexity, cross-module or no clear precedent | opus | medium | Implement a service integrating multiple modules, new API patterns |
| Multi-file changes with cross-module interactions | opus | high | Refactor shared utilities, implement middleware affecting multiple routes |
| Complex algorithms, state management, security-sensitive code | opus | high | Auth logic, payment processing, data migration, concurrency handling |
| New architecture patterns, system design decisions | opus | high | First implementation of a new pattern the codebase will follow |

### Guidelines

- **Default to sonnet/medium** for tasks with clear spec and existing patterns in the codebase. Escalate to `opus` when cross-module reasoning, novel patterns, or security-sensitive logic is involved.
- **Sonnet is the workhorse**: most implementation tasks with a clear spec and codebase precedent run well on sonnet. Reserve opus for tasks where the model needs to reason across module boundaries or make architectural decisions.
- **Effort matters more than model** for quality: `opus` at `medium` handles most implementation work well. Reserve `high` for tasks where reasoning depth directly impacts correctness.
- **Never use `low` effort** for tasks that involve logic, only for pure text/config changes.
- **Fix-loop tasks** (from review findings) always run at `high` effort regardless of plan classification — the build orchestrator overrides this.

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

<!-- optional — directed exploration for build phase: -->
<explore-queries>
- "public API and exports of src/modules/auth" — for task auth-refactor
- "error handling patterns in src/api/handlers" — for task error-handling
</explore-queries>

<tasks>
#### 1. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- **Model**: <sonnet|opus> <!-- optional, default: opus. Use sonnet for simple/pattern-following tasks -->
- **Effort**: <low|medium|high> <!-- optional, default: medium. See Per-Task Model & Effort Classification -->
- **Repo**: <name> <!-- optional, default: primary. Use secondary repo name when task targets a satellite repo -->
- **Spec refs**: <comma-separated spec names from phase <spec> section> <!-- optional -->
- <specific action>
- <specific action>

#### 2. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- **Model**: <sonnet|opus> <!-- optional -->
- **Effort**: <low|medium|high> <!-- optional -->
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
- Inside phase: `<goal>`, `<spec>`, `<explore-queries>` (optional), `<tasks>`, `<execution>`, `<criteria>`, `<handoff>` (except last phase). Each query line: `- "directive text" — for task task-id`. Task-ids must exist in the phase. Optional section.
- Inside spec: `<interface name>`, `<error-contract name>`, `<behavior name>`, `<invariant>`, `<endpoint path method>`. All names must be unique within a phase.
- Task fields: `**ID**` (required), `**Assigned To**` (required), `**Model**` (optional — `sonnet` or `opus`, default: `opus`), `**Effort**` (optional — `low`, `medium`, or `high`, default: `medium`), `**Repo**` (optional — default: primary; set to secondary repo name when task targets a satellite repo), `**Spec refs**` (optional — comma-separated spec names from the phase `<spec>` section)
- Classification values — Type: feature | fix | refactor | migration | chore | enhancement | infrastructure. Complexity: simple | medium | complex. Risk: low | medium | high.
- Endpoint spec refs use the auto-generated `METHOD-/path` format (e.g., `GET-/api/health`) matching the `<endpoint path method>` tag attributes.

## Feedback logging (INLINE PATH only)

During inline builds, log difficulties to `.devorch/feedback.md` in the **main repo** (not the worktree). Same format and triggers as the build command — see build.md § Feedback logging.

After the verdict in step 10i, if `.devorch/feedback.md` exists and has entries from this session, append to the report:

```
### Feedback devorch
N dificuldades registradas nesta sessão. Para evoluir o devorch:
/devorch:talk Evoluir o devorch baseado no feedback de dificuldades em .devorch/feedback.md — analisar padrões, priorizar melhorias e implementar as mais impactantes
```

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING AND ROUTING ONLY.** Do not build, write code, or deploy builder agents (except during INLINE PATH execution).
- **The orchestrator NEVER reads source code files directly** (except for applying trivial fixes during INLINE PATH step 9i review). Use the Agent tool with `subagent_type="Explore"` for all codebase exploration. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches, residual scans). **Rationale**: orchestrators that read source files directly consume context that should remain free for planning, clarification rounds, and plan generation. Explore agents run in isolated context windows, so their work costs zero tokens in the orchestrator's window.
- **Explore agents focus on source code.** Devorch state files (`.devorch/*`) are read by the orchestrator, not by Explore agents. This keeps agent prompts focused and avoids conflicting reads.
- Always validate the plan before reporting.
- Create `.devorch/plans/` directory if needed.
- **Language policy**: User-facing output (questions, reports, summaries, progress messages) in Portuguese pt-BR with correct accentuation (e.g., "não", "ação", "é", "código", "será"). Code, git commits, internal files, and technical documentation in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese text.
- No agents except Explore (for understanding code) and devorch-builder (for INLINE PATH execution only) and devorch-builder-deep (for fix-level findings in INLINE PATH review).
- **Inline builds are single-repo only.** Plans with `<secondary-repos>` always use the worktree path.
- **Output format**: All output to the user must be plain text in the chat. Never use ASCII art, box-drawing characters, or decorative diagrams. Use markdown formatting (headers, lists, bold, code blocks) for structure.
