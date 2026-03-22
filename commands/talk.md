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
- **Edge cases** — Anything the exploration revealed that has no obvious right answer.
- **Multi-repo** — When the task involves or mentions multiple projects/repos, ask which secondary repos should be included as satellites. Present discovered repo paths as options. Each satellite gets its own worktree with the same branch name.
- **Sibling repos (automatic)** — If the map-project.ts output from Step 1 contains a "## Sibling Repos" section, include a question asking which of those repos should be satellites for this plan. List each detected repo as an option (name + relative path). Always include the option "Nenhum — só o repo principal" as the last choice. This question should appear even if the user did not explicitly mention multi-repo.

**Ask in rounds.** Use up to 4 questions per `AskUserQuestion` call (tool limit). If more questions remain, make another call after the user answers. Continue until all ambiguity is resolved — there is no cap on rounds. The goal is **zero assumptions** in the plan.

**Guidelines:**
- Use short, concrete options — not vague ones like "Option A" / "Option B". Each option should describe a real choice (e.g., "JWT with refresh tokens", "Session-based with Redis").
- Front-load the recommended option and append "(Recommended)" to its label.
- Ground questions in what the exploration found — reference real files, patterns, or constraints discovered.
- Don't ask what the codebase or conventions already answer.
- Don't ask the user to make decisions you're better equipped to make (pure implementation details).

### 4. Deep exploration (conditional)

If user answers revealed new areas to explore, launch additional Explore agents targeted by the user's choices. Append findings to `.devorch/explore-cache-<name>.md`.

Use the Agent tool with `subagent_type="Explore"` for all codebase exploration. **Do NOT read source files directly** — use Explore agent summaries as your evidence base. Use Grep directly only for quantification (counting imports, usage patterns).

**Evidence-based planning**: every task must reference real files discovered by Explore agents, not assumptions. Quantify: "Update 14 files that import from X", not "Update files".

### 5. Propose plan

Count total tasks across all phases in the designed plan. Show summary: "Plano: N fases, M tasks, K waves."

Use `AskUserQuestion` with options based on plan characteristics:

**If totalTasks ≤ 8 AND no `<secondary-repos>` in plan:**
- Option 1: "Executar agora — inline build" (Recommended) — "Cria branch, executa fases, verifica e faz merge automático. Ideal para tarefas simples"
- Option 2: "Criar worktree para build separado" — "Worktree isolada + /devorch:build em sessão separada. Melhor para tarefas complexas ou paralelas"

**If totalTasks > 8 OR has `<secondary-repos>`:**
- Option 1: "Criar worktree para build separado" (Recommended) — "Worktree isolada + /devorch:build em sessão separada. Melhor para tarefas complexas ou paralelas"
- Option 2: "Executar agora — inline build" — "Cria branch, executa fases, verifica e faz merge automático. Ideal para tarefas simples"

**Always include:**
- Option 3: "Continuar explorando"
- Option 4: "Encerrar — tenho o que precisava"

**Routing:**
- Option explore → return to Step 2 with new focus
- Option end → summarize findings and stop
- Option worktree → continue to Step 6, then follow **WORKTREE PATH** (Steps 7-11)
- Option inline → continue to Step 6, then follow **INLINE PATH** (Steps 7i-11i)

### 6. Design solution (medium/complex only)

**Effort guidance**: Think deeply. Consider alternatives, edge cases, and long-term implications. This is where reasoning depth matters most.

Think through: core problem, approach, alternatives considered, risks and mitigations.

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

## INLINE PATH (Steps 7i-11i)

### 7i. Create plan inline

1. Write the plan to `.devorch/plans/<name>.md` (NOT `current.md`) following the **Plan Format** below.
2. Validate: `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan .devorch/plans/<name>.md`. Fix if blocked.
3. Delete `.devorch/state.md` if it exists.

### 8i. Create branch

1. Record the current branch: `git branch --show-current` → store as `originalBranch`.
2. Create and switch to inline build branch: `git checkout -b devorch/<name>`.

### 9i. Phase loop

For each phase N sequentially:

#### (a) Init phase

Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan .devorch/plans/<name>.md --phase N --cache-name <name>`.

Parse JSON output. If `contentFile` field is present, read that file for full phase context. Otherwise use the `content` field directly.

#### (b) Deploy builders

For each wave, launch builders as foreground parallel Agent calls (`subagent_type="devorch-builder"`). Each builder receives:
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

**Single-phase plans**: If `totalPhases == 1`, skip per-phase check entirely — the final check in step 10i covers everything. Proceed directly to (d).

**Multi-phase plans** (`totalPhases > 1`): Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <cwd> --quick`. The `--quick` flag runs only build and typecheck (lint and test are skipped).
- If build or typecheck fail: fix ALL errors. If unable to fix after one retry, stop and report.
- If everything passes: proceed.

#### (d) Phase summary and commit

Run `bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan .devorch/plans/<name>.md --phase N --status "ready for phase $((N+1))" --summary "<concise phase summary>"`.

If changes exist (`git status --porcelain`), commit with the generated message.

#### (e) Cache management

Run `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000 --cache-name <name>`.

### 10i. Final verification

Determine changed files: `git diff --name-only <originalBranch>...HEAD`.

**Inline cross-phase check** (orchestrator reads diff files directly):

Using the changed files list, read each changed file with the Read tool and verify:
- Imports resolve — no references to moved/renamed/deleted modules
- No orphan exports — exported symbols are imported somewhere
- No leftover `TODO`/`FIXME`/`HACK`/`XXX` from builders
- Type consistency across module boundaries
- No dead code introduced
- Handoff contracts honored between phases

Record findings with file:line evidence.

**3 adversarial review agents** — foreground parallel Agent calls (`subagent_type="Explore"`):
- Each agent receives: working directory, plan objective, CONVENTIONS.md content, list of changed files
- **security-reviewer**: vulnerabilities, injection risks, auth issues, data exposure, secrets
- **quality-reviewer**: edge cases, error handling, correctness, maintainability
- **completeness-reviewer**: everything from the plan was implemented? anything missing? behavior matches spec?

**Fix findings**:
- **Trivial** (1-2 files, fix is self-evident): fix directly with Edit tool.
- **Fix-level** (well-defined fix, 3+ files or non-trivial logic): launch devorch-builder agents (`subagent_type="devorch-builder"`) as foreground calls.
- **Talk-level** (requires design decisions): do NOT fix, report as pending issue.

**Post-review check**: Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <cwd>`. Parse results.
- If all checks pass: proceed to 11i.
- If any check fails: diagnose and retry once. If retry fails, proceed to 11i with FAIL verdict.

### 11i. Merge and cleanup

**On SUCCESS** (all checks pass, no talk-level issues):

1. Switch to original branch: `git checkout <originalBranch>`
2. Merge: `git merge devorch/<name>` with commit message formatted as `type(scope): <objective>` and body containing plan summary (phases, tasks, key changes).
3. Delete the build branch: `git branch -d devorch/<name>`
4. Cleanup devorch files: delete `.devorch/plans/<name>.md`, `.devorch/explore-cache-<name>.md`, `.devorch/state.md`, `.devorch/project-map.md` (if they exist).
5. Commit cleanup: `chore(devorch): cleanup inline build <name>`
6. Report verdict using the same format as build command step 3d:
   ```
   ## Verificação Final: <plan name>

   ### Integração Cross-phase
   <findings ou "✅ OK">

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

**On FAILURE** (check failures, unresolvable issues):

Do NOT merge. Do NOT delete the branch. Report:
```
Build inline falhou na fase N. Branch `devorch/<name>` preservada com M commits.
```
Suggest: `/devorch:fix` to address remaining issues.

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

<tasks>
#### 1. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- **Repo**: <name> <!-- optional, default: primary. Use secondary repo name when task targets a satellite repo -->
- <specific action>
- <specific action>

#### 2. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- <specific action>

</tasks>

<execution>
**Wave 1** (parallel): <task-id-a>, <task-id-b>
**Wave 2** (after wave 1): <task-id-c>
</execution>

<criteria>
- [ ] <measurable criterion>
</criteria>

<test-contract>
- <test expectation for this phase>
(optional — include when phase produces testable behavior)
</test-contract>

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
- Inside phase: `<goal>`, `<tasks>`, `<execution>`, `<criteria>`, `<test-contract>` (optional), `<handoff>` (except last phase)
- Task fields: `**ID**` (required), `**Assigned To**` (required), `**Repo**` (optional — default: primary; set to secondary repo name when task targets a satellite repo)

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING AND ROUTING ONLY.** Do not build, write code, or deploy builder agents (except during INLINE PATH execution).
- **The orchestrator NEVER reads source code files directly** (except during INLINE PATH steps 10i-11i for review). Use the Agent tool with `subagent_type="Explore"` for all codebase exploration. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches). **Rationale**: orchestrators that read source files directly consume context that should remain free for planning, clarification rounds, and plan generation. Explore agents run in isolated context windows, so their work costs zero tokens in the orchestrator's window.
- **Explore agents focus on source code.** Devorch state files (`.devorch/*`) are read by the orchestrator, not by Explore agents. This keeps agent prompts focused and avoids conflicting reads.
- Always validate the plan before reporting.
- Create `.devorch/plans/` directory if needed.
- **Language policy**: User-facing output (questions, reports, summaries, progress messages) in Portuguese pt-BR with correct accentuation (e.g., "não", "ação", "é", "código", "será"). Code, git commits, internal files, and technical documentation in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese text.
- No agents except Explore (for understanding code) and devorch-builder (for INLINE PATH execution only).
- **Inline builds are single-repo only.** Plans with `<secondary-repos>` always use the worktree path.
