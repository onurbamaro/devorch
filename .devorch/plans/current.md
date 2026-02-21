# Plan: Optimize Build Scripts — Reduce Think Cycles

<description>
Combinar scripts que sempre rodam em sequência no build-phase para reduzir o número de ida-e-volta com a API do Claude. Cada think cycle eliminado economiza 2-5 segundos de latência. O parsing redundante do plano (~2-4ms) não é o gargalo — o gargalo é Claude ter que: ler output → pensar → decidir → chamar próximo script.
</description>

<objective>
Build de 3 fases executa com ~9 think cycles a menos (de ~20 para ~11 chamadas de script no build-phase), economizando ~20-30 segundos por build completo sem perda de qualidade ou funcionalidade.
</objective>

<classification>
Type: refactor
Complexity: medium
Risk: low
</classification>

<decisions>
- Combinar format-commit + update-state → phase-summary.ts (script único) → Sim
- Combinar check-project + run-validation → flag --with-validation no check-project.ts → Sim, via flag para manter compatibilidade com fix.md
- Manter 3 adversarial reviewers paralelos → Sim (não economiza tempo, só tokens; manter robustez)
- Manter cross-phase Explore → Sim (valor genuíno para verificação de handoff e integração entre fases)
- Manter design stateless dos scripts → Sim (re-parsing é ~2-4ms, irrelevante; valor está na composabilidade)
</decisions>

<problem-statement>
Num build de 3 fases, o build-phase.md chama ~7 scripts sequencialmente por fase. Cada chamada custa 2-5 segundos de latência Claude (pensar + executar + ler output + pensar de novo). Dois pares de scripts sempre rodam juntos e poderiam ser unificados: format-commit + update-state (ambos pós-fase), e check-project + run-validation (ambos validação em background).
</problem-statement>

<solution-approach>
1. Criar phase-summary.ts que gera commit message E escreve state.md numa única chamada — elimina 2 think cycles por fase.
2. Adicionar flag --with-validation ao check-project.ts existente — quando passada com --plan e --phase, também executa os comandos de validação do plano. Sem a flag, comportamento idêntico ao atual (fix.md não é afetado). Elimina 1 think cycle por fase.
3. Atualizar build-phase.md para usar os scripts combinados.

Alternativa descartada: criar scripts wrapper que importam módulos — perde a economia do spawn único do Bun.
Alternativa descartada: combinar adversarial reviewers — não economiza tempo (já são paralelos), só tokens.
</solution-approach>

<relevant-files>
- `scripts/format-commit.ts` — lógica de geração de commit message (será absorvida pelo phase-summary)
- `scripts/update-state.ts` — lógica de escrita do state.md (será absorvida pelo phase-summary)
- `scripts/check-project.ts` — validação de projeto (receberá flag --with-validation)
- `scripts/run-validation.ts` — execução de comandos de validação do plano (lógica será absorvida pelo check-project)
- `templates/build-phase.md` — template do agente de fase (será atualizado para usar scripts combinados)
- `scripts/lib/plan-parser.ts` — utilidades compartilhadas de parsing (usado por ambos os scripts novos)
- `scripts/lib/args.ts` — parsing de argumentos CLI
- `scripts/lib/fs-utils.ts` — leitura segura de arquivos

<new-files>
- `scripts/phase-summary.ts` — substitui format-commit + update-state numa única chamada
</new-files>
</relevant-files>

<phase1 name="Create phase-summary.ts">
<goal>Criar script que gera commit message e escreve state.md numa única chamada, substituindo format-commit.ts + update-state.ts</goal>

<tasks>
#### 1. Create phase-summary.ts
- **ID**: create-phase-summary
- **Assigned To**: builder-scripts
- Create `scripts/phase-summary.ts` combining logic from format-commit.ts and update-state.ts
- CLI interface: `--plan <path> --phase <N> --status <text> --summary <text> [--satellites '<json>']`
- JSON output: `{ message: string, phase: number, goal: string, stateFile: string, planTitle: string }`
- Generate commit message in exact format: `phase(<N>): <goal>` (goal truncated to 50 chars with "...")
- Write `.devorch/state.md` with same format as update-state.ts: plan title, phase number, status, summary, satellites section
- Resolve projectRoot same way update-state does: go up from plan path to worktree root (plan is at `<root>/.devorch/plans/current.md`, so root is `../../` relative to plan dir)
- Extract plan title using extractPlanTitle() pattern from update-state.ts (regex on `# Plan: <title>`)
- Extract phase goal using parsePhaseBounds() + extractTagContent(phaseContent, "goal")
- Satellite handling: when --satellites is passed, parse JSON array `[{name, status}]` and write satellites section to state.md
- Import from `./lib/plan-parser.ts`: readPlan, parsePhaseBounds, extractTagContent
- Import from `./lib/args.ts`: parseArgs
- Follow conventions: Bun runtime, no third-party deps, semicolons, double quotes, JSON stdout, errors stderr

#### 2. Validate phase-summary.ts
- **ID**: validate-phase-1
- **Assigned To**: validator
- Run phase-summary.ts with test inputs and verify JSON output has all 5 fields
- Verify state.md written with correct format (plan title, phase, status, summary)
- Verify commit message format: `phase(1): <truncated goal>`
- Run with --satellites and verify satellites section appears in state.md
</tasks>

<execution>
**Wave 1** (build): create-phase-summary
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] phase-summary.ts accepts --plan, --phase, --status, --summary, --satellites flags
- [ ] JSON output contains message, phase, goal, stateFile, planTitle fields
- [ ] Commit message format: `phase(<N>): <goal>` with 50 char truncation
- [ ] state.md written with plan title, phase, status, summary sections
- [ ] Satellite handling: --satellites JSON parsed and written to state.md
- [ ] Script exits 0 on success, 1 on error (missing required args)
</criteria>

<validation>
- `bun scripts/phase-summary.ts 2>&1 | grep -i "required\|usage\|error"` — shows usage when called without args
</validation>

<handoff>
phase-summary.ts criado e funcional. Próxima fase adiciona --with-validation ao check-project.ts.
</handoff>
</phase1>

<phase2 name="Add --with-validation to check-project.ts">
<goal>Adicionar flag --with-validation ao check-project.ts que inclui execução dos comandos de validação do plano, mantendo compatibilidade total com fix.md</goal>

<tasks>
#### 1. Add validation flag to check-project.ts
- **ID**: add-validation-flag
- **Assigned To**: builder-scripts
- Add optional flags to check-project.ts: `--with-validation`, `--plan <path>`, `--phase <N>`
- When `--with-validation` is NOT passed: behavior is 100% identical to current (fix.md compatibility)
- When `--with-validation` IS passed (requires --plan and --phase):
  - Run existing lint/typecheck/build/test checks as before
  - ALSO parse validation commands from the plan's `<validation>` section using regex `/^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/`
  - Execute each validation command via `/bin/bash -c "<command>"` with 30s timeout
  - Resolve working directories from plan's `<tasks>` section (same logic as run-validation.ts)
  - Add `validation` field to JSON output: `{ totalCommands: number, passed: number, failed: number, results: Array<{command, description, cwd, status: "pass"|"fail"|"timeout", output?}> }`
- Output without flag: `{ lint, typecheck, build, test }` (unchanged)
- Output with flag: `{ lint, typecheck, build, test, validation: {...} }`
- Validation commands run in parallel with existing checks (add to the Promise.all that already runs lint/typecheck/build/test)
- Import plan parsing utils: readPlan, parsePhaseBounds, extractTagContent from `./lib/plan-parser.ts`
- Keep run-validation.ts untouched — do not delete it

#### 2. Validate check-project.ts changes
- **ID**: validate-phase-2
- **Assigned To**: validator
- Run check-project.ts WITHOUT --with-validation — verify output shape is `{lint, typecheck, build, test}` only (no validation field)
- Run check-project.ts WITH --with-validation --plan --phase — verify validation field appears
- Verify backward compatibility: fix.md calls check-project without any new flags
</tasks>

<execution>
**Wave 1** (build): add-validation-flag
**Wave 2** (validation): validate-phase-2
</execution>

<criteria>
- [ ] check-project.ts without --with-validation produces identical output to current version
- [ ] check-project.ts with --with-validation adds validation field to JSON output
- [ ] Validation commands parsed from plan's `<validation>` section with correct regex
- [ ] Validation results array contains command, description, cwd, status, output fields
- [ ] Validation commands execute with 30s timeout
- [ ] Working directory resolution matches run-validation.ts logic
- [ ] run-validation.ts file is unchanged
</criteria>

<validation>
- `bun scripts/check-project.ts 2>/dev/null; echo $?` — exits cleanly
</validation>

<handoff>
Ambos os scripts combinados estão prontos. Próxima fase atualiza build-phase.md para usá-los.
</handoff>
</phase2>

<phase3 name="Update build-phase.md template">
<goal>Atualizar build-phase.md para usar phase-summary.ts e check-project --with-validation, eliminando chamadas separadas a format-commit, update-state, e run-validation</goal>

<tasks>
#### 1. Update build-phase template
- **ID**: update-build-phase
- **Assigned To**: builder-docs
- In `templates/build-phase.md`:
  - Replace separate calls to `format-commit.ts` and `update-state.ts` with single call to `phase-summary.ts`:
    ```
    bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan .devorch/plans/current.md --phase N --status "<status>" --summary "<summary>" [--satellites '<json>']
    ```
  - Use the `message` field from phase-summary output as git commit message
  - Replace separate background calls to `check-project.ts` and `run-validation.ts` with single background call:
    ```
    bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --no-test --with-validation --plan .devorch/plans/current.md --phase N
    ```
  - Update instructions for reading validation results: check `validation.failed > 0` instead of reading separate run-validation output
  - Update instructions for reading check results: same fields (lint, typecheck, build, test) plus validation
  - Preserve all existing error handling logic: retry on lint/typecheck fail, warn on pre-existing issues, satellite commits
  - Do NOT change: builder agent prompts, wave execution logic, explore/cache logic, commit flow structure
  - Do NOT modify: build.md (outer orchestrator), devorch-builder.md, any scripts

#### 2. Validate template changes
- **ID**: validate-phase-3
- **Assigned To**: validator
- Verify build-phase.md references phase-summary.ts correctly
- Verify build-phase.md references check-project.ts with --with-validation
- Verify no remaining references to format-commit.ts, update-state.ts, or run-validation.ts
- Verify error handling for lint/typecheck/validation failures is preserved
- Verify satellite handling in phase-summary call is documented
</tasks>

<execution>
**Wave 1** (build): update-build-phase
**Wave 2** (validation): validate-phase-3
</execution>

<criteria>
- [ ] build-phase.md calls phase-summary.ts instead of format-commit + update-state
- [ ] build-phase.md calls check-project --with-validation instead of check-project + run-validation separately
- [ ] Net reduction: 3 fewer script calls per phase (format-commit, update-state, run-validation → phase-summary + check-project --with-validation)
- [ ] Error handling for lint/typecheck failures preserved
- [ ] Satellite commit and state handling preserved
- [ ] No references to format-commit.ts in build-phase.md
- [ ] No references to update-state.ts in build-phase.md
- [ ] No references to run-validation.ts in build-phase.md
- [ ] build.md unchanged
</criteria>

<validation>
- `grep -c "phase-summary" templates/build-phase.md` — at least 1 match
- `grep -c "with-validation" templates/build-phase.md` — at least 1 match
- `grep -c "format-commit" templates/build-phase.md` — 0 matches
- `grep -c "update-state" templates/build-phase.md` — 0 matches
</validation>
</phase3>
