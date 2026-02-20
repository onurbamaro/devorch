---
description: "Conversa + exploração com Agent Teams + plano estruturado"
argument-hint: "<o que quer fazer, explorar ou discutir>"
model: opus
disallowed-tools: EnterPlanMode
---

Conversation, exploration, and structured planning for devorch projects.

**Input**: $ARGUMENTS (description of what you want to do, explore, or discuss). If empty, stop and ask the user.

## Steps

### 1. Load context

**Project data**: Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts --persist` to collect tech stack, folder structure, dependencies, and scripts. Use this output as inline context — do not save it to a file. If the script fails (no Bun, etc.), gather equivalent data via an Explore agent.

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

- **If missing**: Generate it now. Launch 1-2 Explore agents (use the **Task tool call** with `subagent_type="Explore"`) to investigate:
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

### 2. Explore with Agent Teams

Analyze $ARGUMENTS and determine the exploration team composition:

**Template teams** (use when the task type is clear):

| Tipo | Roles |
|---|---|
| Feature/Enhancement | architecture-explorer (como encaixa na arquitetura), risk-assessor (o que pode dar errado, edge cases), pattern-analyst (padrões existentes a seguir) |
| Refactor | structure-analyst (estrutura atual + dependências), impact-assessor (blast radius), pattern-proposer (padrões alvo baseados nas convenções) |
| Bug complexo | 2-3 investigadores, cada um com hipótese distinta sobre a causa raiz |
| New project | skip (não há código para explorar; usar discovery mode do Step 1) |

**Dynamic team** (when no template applies):

Think through the following before composing the team:
```
Analise a tarefa e responda mentalmente:
1. Que dimensões esta tarefa tem? (UI, dados, performance, segurança, UX, infraestrutura...)
2. Que perspectivas distintas encontrariam problemas diferentes?
3. Que tensões existem? (performance vs legibilidade, flexibilidade vs simplicidade...)

Crie 2-4 agentes onde:
- Cada agente tem foco DISTINTO dos outros
- Nenhum agente repete o trabalho de outro
- Juntos cobrem >=90% dos riscos e áreas da tarefa
- Cada agente sabe o que os outros estão cobrindo
```

**Execution**: Launch all explorers as parallel Task calls with `subagent_type="Explore"` in a single message. Each prompt includes: role, specific focus, $ARGUMENTS, CONVENTIONS.md (if it exists). Do NOT use TeamCreate for exploration — parallel Task agents are faster and exploration does not need inter-agent coordination.

After all return: write combined findings to `.devorch/explore-cache.md` with format:
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

**Ask in rounds.** Use up to 4 questions per `AskUserQuestion` call (tool limit). If more questions remain, make another call after the user answers. Continue until all ambiguity is resolved — there is no cap on rounds. The goal is **zero assumptions** in the plan.

**Guidelines:**
- Use short, concrete options — not vague ones like "Option A" / "Option B". Each option should describe a real choice (e.g., "JWT with refresh tokens", "Session-based with Redis").
- Front-load the recommended option and append "(Recommended)" to its label.
- Ground questions in what the exploration found — reference real files, patterns, or constraints discovered.
- Don't ask what the codebase or conventions already answer.
- Don't ask the user to make decisions you're better equipped to make (pure implementation details).

### 4. Deep exploration (conditional)

If user answers revealed new areas to explore, launch additional Explore agents targeted by the user's choices. Append findings to `.devorch/explore-cache.md`.

Use the **Task tool call** with `subagent_type="Explore"` for all codebase exploration. **Do NOT read source files directly** — use Explore agent summaries as your evidence base. Use Grep directly only for quantification (counting imports, usage patterns).

**Evidence-based planning**: every task must reference real files discovered by Explore agents, not assumptions. Quantify: "Update 14 files that import from X", not "Update files".

### 5. Propose plan

Use `AskUserQuestion`:
- Option 1: "Gerar plano e worktree" (Recommended)
- Option 2: "Continuar explorando"
- Option 3: "Encerrar — tenho o que precisava"

If option 2: return to Step 2 with new focus.
If option 3: summarize findings and end.
If option 1: continue to Step 6.

### 6. Design solution (medium/complex only)

Think through: core problem, approach, alternatives considered, risks and mitigations.

### 7. Create plan

1. Derive a kebab-case name from the plan's descriptive name (e.g., "Courier Payroll Export" -> `courier-payroll-export`).
2. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <kebab-name>`. Parse the JSON output to get `worktreePath`.
3. Write the plan to `<worktreePath>/.devorch/plans/current.md` following the **Plan Format** below.
4. Copy `.devorch/CONVENTIONS.md` to `<worktreePath>/.devorch/CONVENTIONS.md` (if it exists or was just generated).
5. Do NOT copy `explore-cache.md` — it stays in the main repo. Worktrees read cache from main via `--cache-root`.
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

Also commit any devorch files changed in the main repo (explore-cache.md, CONVENTIONS.md):
- Stage `.devorch/explore-cache.md`, `.devorch/CONVENTIONS.md` (if created/updated)
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

## Parallelization Rules

Maximize parallel execution without losing quality:

- **Break work into independent units.** If a large task can be split into two tasks that touch different files, split it.
- **Group independent tasks into the same wave.** All tasks in a wave run as parallel agents.
- **Only create sequential waves when truly necessary**: task B reads output of task A, or both modify the same file.
- **Validation is always the last wave**, after all build tasks complete.
- **Aim for wide waves**: 3 parallel tasks in 1 wave is better than 3 sequential waves of 1 task.

Quality guardrails:
- Two tasks in the same wave must NOT modify the same file.
- Two tasks in the same wave must NOT have a producer/consumer relationship.
- Each task must be self-contained — a builder should complete it without needing another builder's uncommitted work.

## Sizing Rules

- Max **5 tasks** per phase. Each completable by one builder.
- Each phase MUST fit in 1 phase execution without context compaction.
- Prefer more smaller phases over fewer large ones.

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
</relevant-files>

<phase1 name="Name">
<goal>one sentence</goal>

<tasks>
#### 1. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- <specific action>
- <specific action>

#### 2. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: <builder-name>
- <specific action>

#### N. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify acceptance criteria
- Run validation commands
</tasks>

<execution>
**Wave 1** (parallel): <task-id-a>, <task-id-b>
**Wave 2** (after wave 1): <task-id-c>
**Wave 3** (validation): validate-phase-1
</execution>

<criteria>
- [ ] <measurable criterion>
</criteria>

<validation>
- `<command>` — <what it checks>
</validation>

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

- Tags used at top-level: `<description>`, `<objective>`, `<classification>`, `<decisions>`, `<problem-statement>` (medium/complex), `<solution-approach>` (medium/complex), `<relevant-files>`, `<new-files>` (nested in relevant-files)
- Phase tags: `<phaseN name="...">` where N is sequential integer
- Inside phase: `<goal>`, `<tasks>`, `<execution>`, `<criteria>`, `<validation>`, `<test-contract>` (optional), `<handoff>` (except last phase)

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING AND ROUTING ONLY.** Do not build, write code, or deploy builder agents.
- **The orchestrator NEVER reads source code files directly.** Use the **Task tool call** with `subagent_type="Explore"` for all codebase exploration. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches). **Rationale**: orchestrators that read source files directly consume context that should remain free for planning, clarification rounds, and plan generation. Explore agents run in isolated context windows, so their work costs zero tokens in the orchestrator's window.
- **Explore agents focus on source code.** Devorch state files (`.devorch/*`) are read by the orchestrator, not by Explore agents. This keeps agent prompts focused and avoids conflicting reads.
- Always validate the plan before reporting.
- Create `.devorch/plans/` directory if needed.
- All user-facing text in Portuguese must use correct pt-BR accentuation and grammar (e.g., "não", "ação", "é", "código", "será"). Never write Portuguese without proper accents.
- No Task agents except Explore (for understanding code).
