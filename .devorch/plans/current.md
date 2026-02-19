# Plan: Devorch Unification — Single Command + Waste Elimination

<description>
Unifica make-plan e quick num único comando /devorch com routing inteligente (conversa, quick path, plan path). Elimina ~600 linhas de código duplicado criando shared lib. Consolida scripts redundantes (merge extract-waves → init-phase, tally → extract-criteria). Remove desperdícios no pipeline de build (validação N+1, build-summary, state-history, phase commits vazios). Atualiza todos os templates e comandos para as novas interfaces.
</description>

<objective>
Quando completo: (1) /devorch é o único entry point — classifica automaticamente e roteia para conversa, quick path, ou plan path. (2) Scripts compartilham lib/ sem duplicação. (3) Build pipeline não re-faz trabalho desnecessário. (4) make-plan.md e quick.md não existem mais.
</objective>

<classification>
Type: refactor
Complexity: complex
Risk: high
</classification>

<decisions>
Aliases para make-plan/quick → Remover completamente. Só /devorch existe.
Modo conversa → Agent Teams quando disponível, fallback para Explore agents simples.
Worktree para simple plans → Manter worktree sempre. --auto vira default para simple/medium. --review para pausar.
build-summary.md → Não gerar mais. Eliminar generate-summary.ts e o step de build-summary.
Shared lib → scripts/lib/ com imports. Scripts continuam como entry points independentes.
Install pipeline → install.ts copia lib/ também para ~/.claude/devorch-scripts/lib/.
Arquivo do comando unificado → commands/devorch.md. install.ts instala em ~/.claude/commands/devorch.md (raiz, não subdir) para que o skill name seja /devorch.
</decisions>

<problem-statement>
O devorch tem 3 entry points (make-plan, quick, e nenhum para conversa), forçando o usuário a classificar sua task antes de começar. Internamente, 19 scripts duplicam ~600 linhas de parsing e utilitários. O pipeline de build re-faz trabalho (validação N+1, plan re-parsed 5-6x/fase, explore cache descartado no check). Scripts consolidáveis existem separados (extract-waves, tally-criteria, generate-summary).
</problem-statement>

<solution-approach>
1. Criar scripts/lib/ com módulos compartilhados (plan-parser, args, fs-utils) — elimina duplicação na raiz.
2. Consolidar scripts: merge extract-waves → init-phase, tally → extract-criteria, remover generate-summary e state-history.
3. Atualizar templates/comandos para novas interfaces e corrigir desperdícios (validação condicional, explore-cache no check, phase commit condicional).
4. Criar commands/devorch.md unificado com 3 paths: conversa (explore iterativo), quick (checklist binário preservado), plan (flow completo com --auto default).
Alternativa descartada: consolidar scripts em poucos mega-scripts. Rejeitado porque cada script é um entry point independente que precisa funcionar standalone.
</solution-approach>

<relevant-files>
- `scripts/init-phase.ts` — absorve extract-waves, refatorado para usar lib
- `scripts/extract-waves.ts` — será deletado após merge em init-phase
- `scripts/extract-criteria.ts` — absorve tally-criteria, ganha --tally flag
- `scripts/tally-criteria.ts` — será deletado após merge em extract-criteria
- `scripts/generate-summary.ts` — será deletado (build-summary eliminado)
- `scripts/update-state.ts` — simplificado: remove state-history.md
- `scripts/format-commit.ts` — ganha --goal flag para evitar re-read do plan
- `scripts/map-project.ts` — ganha --persist para salvar em .devorch/project-map.md
- `scripts/check-agent-teams.ts` — callers passam a usar templates do JSON output
- `scripts/archive-plan.ts` — refatorado para usar lib
- `scripts/check-project.ts` — refatorado para usar lib
- `scripts/hash-plan.ts` — refatorado para usar lib
- `scripts/list-worktrees.ts` — refatorado para usar lib
- `scripts/manage-cache.ts` — refatorado para usar lib
- `scripts/map-conventions.ts` — refatorado para usar lib
- `scripts/run-validation.ts` — refatorado para usar lib
- `scripts/setup-worktree.ts` — refatorado para usar lib
- `scripts/validate-plan.ts` — refatorado para usar lib
- `scripts/verify-build.ts` — refatorado para usar lib
- `templates/build-phase.md` — remove step extract-waves, phase commit condicional
- `commands/check-implementation.md` — validação condicional, explore-cache no Explore agent, usa templates do check-agent-teams
- `commands/build.md` — remove generate-summary + build-summary commit, referências make-plan → /devorch
- `commands/explore-deep.md` — usa templates do check-agent-teams output
- `commands/review.md` — usa templates do check-agent-teams output
- `commands/debug.md` — usa templates do check-agent-teams output
- `commands/make-plan.md` — será deletado
- `commands/quick.md` — será deletado
- `install.ts` — copia lib/, instala devorch.md na raiz de commands
- `uninstall.ts` — remove devorch-scripts/lib/, remove devorch.md da raiz
- `README.md` — atualiza todas as referências
- `.devorch/CONVENTIONS.md` — remove referência a state-history.md

<new-files>
- `scripts/lib/plan-parser.ts` — extractTagContent, parsePhaseBounds, readPlan, extractPlanTitle
- `scripts/lib/args.ts` — parseArgs genérico com typed flag definitions
- `scripts/lib/fs-utils.ts` — safeReadFile, safeWriteFile
- `commands/devorch.md` — comando unificado com 3 paths (conversa, quick, plan)
</new-files>
</relevant-files>

<phase1 name="Shared Library Foundation">
<goal>Criar módulos utilitários compartilhados e atualizar o pipeline de instalação para suportá-los.</goal>

<tasks>
#### 1. Create plan-parser library module
- **ID**: create-plan-parser
- **Assigned To**: builder-1
- Create `scripts/lib/plan-parser.ts` with:
  - `extractTagContent(text: string, tagName: string): string | null` — Variant B (line-start-anchored regex: `^\s*<tagName>` with `im` flags). This is the canonical implementation.
  - `interface PhaseBounds { phase: number; name: string; start: number; end: number; content: string }`
  - `parsePhaseBounds(planContent: string): PhaseBounds[]` — single-pass line scan for `<phaseN name="...">` / `</phaseN>` pairs. Returns array sorted by phase number.
  - `readPlan(planPath: string): string` — reads plan file with try/catch, exits 1 on failure with stderr message.
  - `extractPlanTitle(planContent: string): string` — regex `^#\s+Plan:\s+(.+)$` match, defaults to "Untitled Plan".
  - `extractFileEntries(block: string): Array<{ path: string; description: string }>` — parses `- \`path\` — description` format from relevant-files/new-files blocks.
- Follow CONVENTIONS.md: double quotes, 2-space indent, semicolons, named imports from `fs` and `path`, Variant B regex only, no default exports — use named exports.
- File must be importable by other scripts via `import { extractTagContent, parsePhaseBounds, readPlan, extractPlanTitle, extractFileEntries } from "./lib/plan-parser";`

#### 2. Create args and fs-utils library modules
- **ID**: create-args-fsutils
- **Assigned To**: builder-2
- Create `scripts/lib/args.ts` with:
  - `interface FlagDef { name: string; type: "string" | "number" | "boolean"; required?: boolean }`
  - `parseArgs<T>(defs: FlagDef[]): T` — parses `process.argv.slice(2)` for `--flag value` pairs. Exits 1 with usage message if required flag missing. Returns typed object.
  - Keep it simple — no positional args support (scripts that use positional args keep their own 1-line parse).
- Create `scripts/lib/fs-utils.ts` with:
  - `safeReadFile(filePath: string): string` — returns empty string on missing/unreadable file. Uses `existsSync` + `readFileSync` with try/catch.
- Follow CONVENTIONS.md: named exports only, no third-party deps.

#### 3. Update install and uninstall for lib directory
- **ID**: update-install
- **Assigned To**: builder-3
- In `install.ts`:
  - The scripts copy step already uses recursive copy. Verify that `scripts/lib/` is included when copying `scripts/` → `~/.claude/devorch-scripts/`. If not, ensure recursive copy includes subdirectories.
  - Add handling for `commands/devorch.md`: if the file exists in source `commands/`, copy it to `~/.claude/commands/devorch.md` (root level, NOT into the devorch/ subdirectory). This makes the skill name `/devorch` instead of `/devorch:devorch`.
  - Update the final console message from `"/devorch:make-plan"` to `"/devorch"`.
- In `uninstall.ts`:
  - Add removal of `~/.claude/commands/devorch.md` (root level file).
  - Add removal of `~/.claude/devorch-templates/` (currently missing — oversight in original).

#### 4. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify `scripts/lib/plan-parser.ts` exports all 5 functions with correct signatures
- Verify `scripts/lib/args.ts` exports `parseArgs` with correct signature
- Verify `scripts/lib/fs-utils.ts` exports `safeReadFile` with correct signature
- Run `bun C:/Users/bruno/Documents/Dev/devorch/.worktrees/devorch-unification/scripts/lib/plan-parser.ts` — should be importable (no runtime errors on import)
- Verify install.ts handles commands/devorch.md root-level copy
- Verify uninstall.ts removes devorch-templates/
</tasks>

<execution>
**Wave 1** (parallel): create-plan-parser, create-args-fsutils
**Wave 2** (after wave 1): update-install
**Wave 3** (validation): validate-phase-1
</execution>

<criteria>
- [ ] scripts/lib/plan-parser.ts exists with all 5 named exports
- [ ] scripts/lib/args.ts exists with parseArgs export
- [ ] scripts/lib/fs-utils.ts exists with safeReadFile export
- [ ] All lib files pass `bun --bun check` (typecheck)
- [ ] install.ts copies scripts/lib/ to ~/.claude/devorch-scripts/lib/
- [ ] install.ts copies commands/devorch.md to ~/.claude/commands/devorch.md (root)
- [ ] uninstall.ts removes ~/.claude/commands/devorch.md and ~/.claude/devorch-templates/
</criteria>

<validation>
- `cd .worktrees/devorch-unification && bun scripts/lib/plan-parser.ts` — no import errors
- `cd .worktrees/devorch-unification && bun scripts/lib/args.ts` — no import errors
</validation>

<handoff>
Shared lib is available at scripts/lib/. Phase 2 will refactor all 19 scripts to import from it, merge redundant scripts, and delete obsolete ones. The lib modules define the canonical implementations of parseArgs, extractTagContent, parsePhaseBounds, readPlan, extractPlanTitle, safeReadFile.
</handoff>
</phase1>

<phase2 name="Script Consolidation">
<goal>Refatorar todos os 19 scripts para usar shared lib, consolidar scripts redundantes, e eliminar código morto.</goal>

<tasks>
#### 1. Merge extract-waves into init-phase and refactor
- **ID**: merge-waves-into-init
- **Assigned To**: builder-1
- In `scripts/init-phase.ts`:
  - Replace inline `extractTagContent`, `parsePhaseBounds`, `readPlan`, `extractPlanTitle`, `safeReadFile` with imports from `./lib/plan-parser` and `./lib/fs-utils`
  - Replace inline `parseArgs` with import from `./lib/args`
  - Add `waves` and `tasks` fields to the JSON output (same format as current extract-waves.ts output: `waves: Array<{ wave: number; taskIds: string[] }>`, `tasks: Record<string, { id: string; name: string; assignedTo: string; content: string }>`)
  - Parse the `<execution>` block within the target phase to extract wave definitions
  - Parse the `<tasks>` block to extract task details (ID, name, assigned-to, bullet content)
  - The `filterCache` function stays in init-phase (it's specific to this script's logic)
- Delete `scripts/extract-waves.ts`

#### 2. Merge tally into extract-criteria, simplify update-state and format-commit
- **ID**: merge-tally-and-simplify
- **Assigned To**: builder-2
- In `scripts/extract-criteria.ts`:
  - Replace inline parsing with imports from `./lib/plan-parser` and `./lib/args`
  - Fix `extractTagContent` to use Variant B (currently uses Variant A — latent bug)
  - Add `--tally` flag: when present, also reads `state.md` (relative to plan dir) and computes per-phase pass/fail tally. Output includes additional fields: `tally: { total: number; passed: number; perPhase: Array<{ phase: number; total: number; passed: number; status: string }> }`
- Delete `scripts/tally-criteria.ts`
- In `scripts/update-state.ts`:
  - Replace inline parsing with imports from shared lib
  - Remove all state-history.md logic: no more reading/appending to state-history.md. Only write state.md.
- In `scripts/format-commit.ts`:
  - Replace inline parsing with imports from shared lib
  - Add `--goal <text>` flag as alternative to `--plan --phase`. When `--goal` is provided, skip plan file reading and use the goal text directly for the commit message. When `--plan --phase` is provided, behave as before (reading from plan).

#### 3. Refactor remaining plan-related scripts to use shared lib
- **ID**: refactor-plan-scripts
- **Assigned To**: builder-3
- Refactor each script: replace inline `parseArgs`, `extractTagContent`, `parsePhaseBounds`, `readPlan`, `extractPlanTitle`, `safeReadFile`, and plan-read boilerplate with imports from `./lib/plan-parser`, `./lib/args`, `./lib/fs-utils`
- Scripts to refactor: `run-validation.ts`, `validate-plan.ts`, `hash-plan.ts`, `archive-plan.ts`, `verify-build.ts`, `generate-summary.ts`
- Note: generate-summary.ts will be deleted in Phase 3, but refactor it here for consistency — if build.md calls it before Phase 3 is deployed, it still works.
- Ensure each script's CLI interface (args, JSON output format) remains identical. Only internals change.

#### 4. Refactor remaining infrastructure scripts to use shared lib
- **ID**: refactor-infra-scripts
- **Assigned To**: builder-4
- Scripts to refactor: `check-project.ts`, `check-agent-teams.ts`, `setup-worktree.ts`, `list-worktrees.ts`, `manage-cache.ts`, `map-project.ts`, `map-conventions.ts`
- These scripts have less overlap with plan-parser (most only use parseArgs or safeReadFile), but standardize their arg parsing and file reading through the shared lib.
- For `map-project.ts`: add `--persist` flag. When present, write the output to `.devorch/project-map.md` in the current directory (in addition to stdout). Include a `Generated: <ISO timestamp>` header.
- Ensure CLI interfaces remain identical for all scripts.

#### 5. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verify extract-waves.ts is deleted
- Verify tally-criteria.ts is deleted
- Verify init-phase.ts output now includes `waves` and `tasks` fields
- Verify extract-criteria.ts with --tally produces tally output
- Verify update-state.ts no longer writes state-history.md
- Verify format-commit.ts accepts --goal flag
- Verify map-project.ts with --persist writes .devorch/project-map.md
- Verify all 17 remaining scripts still produce valid JSON output (unchanged CLI interface)
- Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` on the worktree
</tasks>

<execution>
**Wave 1** (parallel): merge-waves-into-init, merge-tally-and-simplify
**Wave 2** (parallel, after wave 1): refactor-plan-scripts, refactor-infra-scripts
**Wave 3** (validation): validate-phase-2
</execution>

<criteria>
- [ ] extract-waves.ts deleted, init-phase.ts emits waves+tasks in JSON output
- [ ] tally-criteria.ts deleted, extract-criteria.ts --tally works
- [ ] update-state.ts does not reference state-history.md
- [ ] format-commit.ts accepts --goal as alternative input
- [ ] map-project.ts --persist writes .devorch/project-map.md
- [ ] All 17 remaining scripts pass typecheck
- [ ] No script contains inline extractTagContent, parsePhaseBounds, or parseArgs (all imported from lib)
- [ ] extractTagContent uses only Variant B (line-start-anchored) everywhere
</criteria>

<validation>
- `cd .worktrees/devorch-unification && bun scripts/init-phase.ts --plan .devorch/plans/current.md --phase 1` — verify waves/tasks in output
- `cd .worktrees/devorch-unification && bun scripts/extract-criteria.ts --plan .devorch/plans/current.md --tally` — verify tally fields
- `cd .worktrees/devorch-unification && bun scripts/format-commit.ts --goal "test goal" --phase 1` — verify message output
</validation>

<handoff>
All scripts now use shared lib. extract-waves.ts and tally-criteria.ts are deleted. init-phase.ts output includes waves+tasks. Phase 3 updates the .md templates and commands to reference the new interfaces. Key changes for Phase 3: build-phase.md must remove extract-waves step (use init-phase waves), check-implementation.md must use extract-criteria --tally instead of tally-criteria, build.md must remove generate-summary step.
</handoff>
</phase2>

<phase3 name="Build Pipeline Updates">
<goal>Atualizar templates e comandos para as novas interfaces de script e eliminar desperdícios no pipeline de build.</goal>

<tasks>
#### 1. Update build-phase template
- **ID**: update-build-phase
- **Assigned To**: builder-1
- In `templates/build-phase.md`:
  - **Remove Step 3** (extract-waves): delete the entire step. Waves and tasks now come from init-phase.ts output (Step 1). Update Step 4 to reference "waves and tasks from init-phase output" instead of "from extract-waves output".
  - **Renumber steps**: after removing Step 3, renumber all subsequent steps (old Step 4 → new Step 3, etc.)
  - **Conditional phase commit** (old Step 7, now Step 6): change from "If there are uncommitted changes after validation passes" to explicit check: "Run `git -C <projectRoot> status --porcelain`. If output is empty, skip commit. If output has changes, run format-commit.ts..."
  - **format-commit with --goal** (same step): the phase goal is already available from init-phase output. Pass it directly: `bun ... format-commit.ts --goal "<goal text from init-phase>" --phase N` instead of `--plan <planPath> --phase N`. This eliminates one plan re-read.
  - **Update state step** (old Step 9, now Step 8): remove mention of "archives the old phase summary to state-history.md". Just say "writes state.md with the latest phase summary".
  - Keep all other steps (init-phase, explore, deploy builders, run-validation, deploy validator, manage-cache, report) unchanged.

#### 2. Update check-implementation command
- **ID**: update-check-impl
- **Assigned To**: builder-2
- In `commands/check-implementation.md`:
  - **Replace tally-criteria.ts** (Step 3): change `bun .../tally-criteria.ts --plan <planPath>` to `bun .../extract-criteria.ts --plan <planPath> --tally`. Update the output parsing to match the new combined format.
  - **Conditional validation re-run** (Step 3): instead of unconditionally re-running all validation commands from all phases, add logic: "For each phase's validation commands, check if the git diff (from Step 2) includes files in that phase's relevant-files list. Only re-run validation commands for phases whose files were touched by subsequent phases. Always run global checks (like `tsc --noEmit`, `bun test`) exactly once."
  - **Pass explore-cache to Explore agent** (Step 3): add to the Explore agent prompt: "Read non-invalidated sections from `<mainRoot>/.devorch/explore-cache.md` for structural context of unchanged areas." This gives the agent cached knowledge without stale data risk.
  - **Use check-agent-teams templates** (Step 4): remove the line "Read `.devorch/team-templates.md` and extract the `check-team` template". Instead: "Use the `templates` field from the check-agent-teams.ts JSON output (already parsed in this step) to get the check-team configuration."
  - **Update make-plan references**: change `/devorch:make-plan` to `/devorch` in Step 6c (complex issue suggestion) and in the description/frontmatter.

#### 3. Update build command
- **ID**: update-build-cmd
- **Assigned To**: builder-3
- In `commands/build.md`:
  - **Remove Step 4** (build summary): delete the entire generate-summary step including the commit. The step that ran `generate-summary.ts`, staged `build-summary.md`, and committed it is eliminated.
  - **Renumber steps**: after removing Step 4, renumber subsequent steps.
  - **Remove state-history.md reference**: in the prose about state files, remove mention of state-history.md.
  - **Update error message**: change `"No active worktrees. Run /devorch:make-plan first."` to `"No active worktrees. Run /devorch first."`.
  - **Delete generate-summary.ts**: the script has no callers after this change. Delete `scripts/generate-summary.ts`.

#### 4. Update Agent Teams command files
- **ID**: update-agent-teams-cmds
- **Assigned To**: builder-4
- In `commands/explore-deep.md`, `commands/review.md`, `commands/debug.md`:
  - Each currently runs `check-agent-teams.ts` then separately reads `.devorch/team-templates.md` to extract their team template.
  - Change: after running `check-agent-teams.ts`, use the `templates` field from its JSON output directly. Remove the separate "Read `.devorch/team-templates.md`" instruction.
  - The template data is already in the JSON — callers just need to access `templates["explore-deep"]`, `templates["review"]`, or `templates["debug"]` respectively.

#### 5. Validate Phase
- **ID**: validate-phase-3
- **Assigned To**: validator
- Verify build-phase.md no longer references extract-waves.ts
- Verify build-phase.md has explicit git status check before phase commit
- Verify build-phase.md uses --goal flag for format-commit
- Verify check-implementation.md references extract-criteria --tally (not tally-criteria)
- Verify check-implementation.md has conditional validation logic
- Verify check-implementation.md passes explore-cache to Explore agent
- Verify check-implementation.md uses check-agent-teams templates (no manual team-templates.md read)
- Verify build.md has no generate-summary step
- Verify build.md has no build-summary commit step
- Verify generate-summary.ts is deleted
- Verify explore-deep.md, review.md, debug.md use check-agent-teams templates directly
- Verify no .md file references tally-criteria.ts, extract-waves.ts, or generate-summary.ts
</tasks>

<execution>
**Wave 1** (parallel): update-build-phase, update-check-impl, update-build-cmd, update-agent-teams-cmds
**Wave 2** (validation): validate-phase-3
</execution>

<criteria>
- [ ] build-phase.md: no extract-waves step, conditional phase commit with explicit git status, format-commit uses --goal, no state-history mention
- [ ] check-implementation.md: uses extract-criteria --tally, conditional validation by diff, explore-cache in Explore agent prompt, check-agent-teams templates used directly
- [ ] build.md: no generate-summary step, no build-summary commit, references /devorch instead of /devorch:make-plan
- [ ] generate-summary.ts deleted
- [ ] explore-deep.md, review.md, debug.md: no manual team-templates.md read, use check-agent-teams templates
- [ ] Zero references to extract-waves.ts, tally-criteria.ts, or generate-summary.ts in any .md file
</criteria>

<validation>
- `grep -r "extract-waves" .worktrees/devorch-unification/commands/ .worktrees/devorch-unification/templates/` — zero results
- `grep -r "tally-criteria" .worktrees/devorch-unification/commands/ .worktrees/devorch-unification/templates/` — zero results
- `grep -r "generate-summary" .worktrees/devorch-unification/commands/ .worktrees/devorch-unification/templates/` — zero results
- `grep -r "team-templates.md" .worktrees/devorch-unification/commands/` — zero results (all callers use check-agent-teams output)
</validation>

<handoff>
All templates and commands now use the consolidated script interfaces. No .md file references deleted scripts. Phase 4 creates the unified /devorch command, deletes old command files, and updates documentation.
</handoff>
</phase3>

<phase4 name="Unified Command + Cleanup">
<goal>Criar o comando unificado /devorch com 3 paths, deletar comandos obsoletos, e atualizar toda documentação.</goal>

<tasks>
#### 1. Create unified /devorch command
- **ID**: create-devorch-cmd
- **Assigned To**: builder-1
- Create `commands/devorch.md` with YAML frontmatter: `model: opus`, `description: "Unified devorch entry point — routes to conversation, quick fix, or full planning"`, `argument-hint: "<description of what you want to do>"`.
- The command implements this flow:
  - **Step 1 — Load context**: Run `map-project.ts --persist`. Read CONVENTIONS.md if exists. Same as current make-plan Step 1 (legacy migration, conventions generation).
  - **Step 2 — Classify intent**: Based on user input, classify into one of 3 paths:
    - **Conversation** — user is exploring an idea, asking a question, discussing architecture, or unsure what they want. Signals: question marks, words like "como", "será que", "pensei em", "dúvida", "ideia", "explorar", "entender", or explicitly saying they want to discuss.
    - **Task** — user has a concrete change to make. Proceed to Step 3.
  - **Step 3 — Quick gate (tasks only)**: Apply the binary checklist from quick.md (≤3 files, no API changes, no new deps, existing coverage, mechanically verifiable). ALL YES → Quick Path. ANY NO → Plan Path. No subjective judgment. "A frase 'mas nesse caso' é um red flag."
  - **Quick Path** (Steps Q1-Q4): Same as current quick.md — optional Explore agent, implement, check-project, auto-commit, report.
  - **Plan Path** (Steps P1-P10): Same as current make-plan.md — classify type/complexity/risk, optional Agent Teams, explore, clarify (AskUserQuestion), deep explore, design, create plan in worktree, validate, reset state, auto-commit. Then:
    - If simple or medium complexity: auto-build (spawn build as Task, same as current --auto behavior). User can pass `--review` flag to pause instead.
    - If complex: pause, show plan, instruct `/clear` then `/devorch:build --plan <name>`. User can pass `--auto` flag to skip the pause.
  - **Conversation Path** (Steps C1-C4):
    - C1: Run `check-agent-teams.ts`. If enabled → spawn explore-deep team (from templates). If not → launch 1-2 Explore agents for the topic.
    - C2: Present synthesized findings with follow-up question via `AskUserQuestion`.
    - C3: If user wants to dig deeper → targeted Explore agent for that thread. If user wants to act → classify the action (back to Step 3 for quick gate).
    - C4: When conversation concludes naturally or user says to act, route to Quick Path or Plan Path as appropriate. If no action needed, end with optional report.
- The command must include all the rules from make-plan.md: orchestrator never reads source directly (Explore agents only), explore-cache management, plan format specification, parallelization rules, sizing rules.
- Include the complete Plan Format XML specification (same as current make-plan.md).

#### 2. Delete old commands and update install
- **ID**: delete-old-commands
- **Assigned To**: builder-2
- Delete `commands/make-plan.md`
- Delete `commands/quick.md`
- In `install.ts`: the commands/ copy step already handles all .md files. Since make-plan.md and quick.md are deleted, they won't be copied. Verify the devorch.md root-level copy from Phase 1 is working.
- Delete `commands/plan-tests.md` and `commands/build-tests.md` if they reference make-plan by name and need updating. If they're independent, leave them.

#### 3. Update all cross-references
- **ID**: update-references
- **Assigned To**: builder-3
- Global search and replace across all remaining .md files:
  - `/devorch:make-plan` → `/devorch` (in check-implementation.md already done in Phase 3, but verify build-tests.md, plan-tests.md, worktrees.md, any other .md)
  - `/devorch:quick` → `/devorch` (same sweep)
  - `make-plan.md` → `devorch.md` (in prose references)
  - `quick.md` → `devorch.md` (in prose references)
- In `.devorch/CONVENTIONS.md`:
  - Remove line 102: `State.md contains only the latest phase summary — history goes to state-history.md` → replace with `State.md contains only the latest phase summary`
  - Add note about shared lib: in the Patterns section, add that scripts import shared utilities from `./lib/plan-parser`, `./lib/args`, `./lib/fs-utils`
- In `.devorch/team-templates.md`: the `make-plan-team` section header can stay (it's the team name, not the command name). No change needed.

#### 4. Update README
- **ID**: update-readme
- **Assigned To**: builder-4
- Rewrite relevant sections of `README.md`:
  - Replace all `/devorch:make-plan` examples with `/devorch`
  - Replace all `/devorch:quick` examples with `/devorch`
  - Update the command reference table: remove make-plan and quick rows, add single /devorch row with description of 3-path routing
  - Update the "Getting Started" section to show `/devorch` as the entry point
  - Remove references to state-history.md and build-summary.md
  - Add mention of scripts/lib/ in the architecture section
  - Keep all other sections (build, check, explore-deep, review, debug, worktrees) accurate

#### 5. Validate Phase
- **ID**: validate-phase-4
- **Assigned To**: validator
- Verify commands/devorch.md exists with correct YAML frontmatter and all 3 paths
- Verify commands/make-plan.md is deleted
- Verify commands/quick.md is deleted
- Verify zero references to `/devorch:make-plan` or `/devorch:quick` in any .md file (grep)
- Verify CONVENTIONS.md no longer mentions state-history.md
- Verify README.md references /devorch as the main entry point
- Verify the Plan Format specification in devorch.md is complete (all XML tags documented)
- Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` on the worktree
</tasks>

<execution>
**Wave 1** (parallel): create-devorch-cmd, delete-old-commands
**Wave 2** (parallel, after wave 1): update-references, update-readme
**Wave 3** (validation): validate-phase-4
</execution>

<criteria>
- [ ] commands/devorch.md exists with 3-path routing (conversation, quick, plan)
- [ ] commands/make-plan.md deleted
- [ ] commands/quick.md deleted
- [ ] Quick path preserves the exact 5-item binary checklist (no subjective judgment)
- [ ] Plan path includes --auto as default for simple/medium, --review to pause
- [ ] Conversation path uses Agent Teams when available, Explore agents as fallback
- [ ] Zero grep hits for `/devorch:make-plan` or `/devorch:quick` in any active .md file
- [ ] CONVENTIONS.md: no state-history.md reference, mentions scripts/lib/
- [ ] README.md: /devorch is the documented entry point
</criteria>

<validation>
- `grep -r "devorch:make-plan" .worktrees/devorch-unification/commands/ .worktrees/devorch-unification/templates/ .worktrees/devorch-unification/README.md` — zero results
- `grep -r "devorch:quick" .worktrees/devorch-unification/commands/ .worktrees/devorch-unification/templates/ .worktrees/devorch-unification/README.md` — zero results
- `ls .worktrees/devorch-unification/commands/make-plan.md 2>/dev/null` — file not found
- `ls .worktrees/devorch-unification/commands/quick.md 2>/dev/null` — file not found
- `ls .worktrees/devorch-unification/commands/devorch.md` — file exists
</validation>
</phase4>
