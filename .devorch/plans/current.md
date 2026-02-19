# Plan: Otimizar Performance do Build + Fix Naming /devorch

<description>
Reduz tempo de build de ~1h para ~25-35min com múltiplas otimizações: (1) move check-project.ts de per-task para per-phase, (2) testes só no final, (3) checks em paralelo total, (4) melhor reuso de explore cache, (5) contexto mais rico para validator e builders, (6) smart dispatch targeted, (7) Explore cross-phase focado. Corrige duplicação do skill `/devorch:devorch`.
</description>

<objective>
Build de 4 fases executa check-project.ts sem testes por fase (lint+typecheck+build only) e testes 1x no final. Checks rodam em paralelo total. Explore agents reusam cache agressivamente. Skill `/devorch:devorch` não existe mais — apenas `/devorch`.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: medium
</classification>

<decisions>
- Builders não rodam mais check-project.ts → Removido do builder, movido para 1x por fase
- Validação por fase mantida → run-validation.ts + validator agent continuam por fase
- check-project.ts 1x por fase (após todos builders) + 1x no final do build
- Final do build: check-project.ts + verify-build.ts + Explore agent cross-phase. Conditional re-run removido.
- Naming: excluir devorch.md da cópia para subdiretório + limpar referências
- Tests só no final → Per-fase roda lint+typecheck+build (--no-test), tests 1x no check-implementation
- check-project.ts roda lint/typecheck/build/test todos em paralelo (não mais lint+tc→build→test sequencial)
- Explore cache mais agressivo → fase só lança Explore se cache não cobre os arquivos relevantes
- Validator recebe resultado do check-project.ts para focar em critérios semânticos
- Smart dispatch re-check targeted → re-roda só checks afetados pelo fix, não tudo
- Explore cross-phase recebe lista explícita de changed files para focar
</decisions>

<problem-statement>
O build executa check-project.ts (lint+typecheck+build+test, 30-120s cada) uma vez por TASK de builder. Com ~10 tasks em 4 fases, são ~10 execuções lentas + 1 no final = ~11 total. O overhead acumulado domina o tempo de build. Além disso, `/devorch:devorch` existe como skill duplicado de `/devorch`.
</problem-statement>

<solution-approach>
1. Remover check-project.ts do devorch-builder.md (builders mantêm só o post-edit lint hook que já é per-file e fast)
2. Adicionar check-project.ts 1x no build-phase.md entre o fim dos builders e o run-validation.ts
3. Remover conditional per-phase validation re-run do check-implementation.md (redundante com check-project.ts no final)
4. Excluir devorch.md da cópia bulk no install.ts (já tem cópia root-level separada)

Alternativa considerada: mover check-project.ts somente para o final absoluto. Rejeitada porque fases constroem uma sobre a outra e erros cedo propagam.
</solution-approach>

<relevant-files>
- `agents/devorch-builder.md` — step 4 chama check-project.ts per-task (remover)
- `templates/build-phase.md` — workflow de fase, inserir check-project.ts, melhorar contexto para builders/validator
- `commands/check-implementation.md` — conditional re-run a remover, smart dispatch targeted, Explore targeted
- `install.ts` — copyDir copia devorch.md para subdiretório (excluir)
- `commands/devorch.md` — verificar referências a devorch:devorch
- `scripts/check-project.ts` — adicionar --no-test flag + full parallel execution
- `agents/devorch-validator.md` — receber resultados do check-project.ts

<new-files>
</new-files>
</relevant-files>

<phase1 name="Otimizar Validação do Build">
<goal>Mover check-project.ts de per-task para per-phase e remover redundâncias no final</goal>

<tasks>
#### 1. Remover check-project.ts do builder
- **ID**: remove-builder-check
- **Assigned To**: builder-1
- Editar `agents/devorch-builder.md`:
  - Remover step 4 inteiro (lines 24-27: "Validate your work" com check-project.ts)
  - Renumerar steps subsequentes (5→4, 6→5, 7→6)
  - Atualizar Red Flags table: remover linhas 41 e 45 que referenciam check-project.ts
  - Manter o post-edit lint hook no frontmatter (hooks section, lines 7-11) — esse é barato e fica

#### 2. Adicionar check-project.ts por fase no build-phase.md
- **ID**: add-phase-check
- **Assigned To**: builder-2
- Editar `templates/build-phase.md`:
  - Remover nota na line 28: "Do NOT include check-project.ts instructions — the builder agent definition already handles validation"
  - Inserir novo step entre o atual step 3 (deploy builders) e step 4 (run-validation.ts):
    ```
    N. Validate phase code:
       - Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot>` in background
       - If checks fail on files modified in this phase, fix or report
       - If checks fail on pre-existing issues, log as warning and proceed
    ```
  - Renumerar steps subsequentes

#### 3. Remover conditional re-run do check-implementation.md
- **ID**: remove-conditional-rerun
- **Assigned To**: builder-3
- Editar `commands/check-implementation.md`:
  - Remover lines 40-41 (conditional per-phase validation re-run block no step 3)
  - Remover seção "Phase Validation Commands" do report template (lines 107-109) — não há mais dados para popular
  - Manter: check-project.ts (lines 37-38), verify-build.ts (line 39), Explore agent (lines 46-61), tally (lines 43-44)

#### 4. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verificar que devorch-builder.md não referencia check-project.ts
- Verificar que build-phase.md tem o novo step de check-project.ts entre builders e run-validation
- Verificar que check-implementation.md não tem conditional re-run
- Verificar que o workflow end-to-end faz sentido (builder → phase check → validation → validator → commit)
</tasks>

<execution>
**Wave 1** (parallel): remove-builder-check, add-phase-check, remove-conditional-rerun
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] devorch-builder.md não contém referência a check-project.ts
- [ ] build-phase.md tem step de check-project.ts após deploy builders e antes de run-validation
- [ ] check-implementation.md não contém "conditional validation re-run"
- [ ] Report template em check-implementation.md não referencia "Phase Validation Commands"
- [ ] Steps em devorch-builder.md estão corretamente numerados (sem gaps)
- [ ] Steps em build-phase.md estão corretamente numerados (sem gaps)
</criteria>

<validation>
- `grep -c "check-project" agents/devorch-builder.md` — deve retornar 0
- `grep -c "check-project" templates/build-phase.md` — deve retornar 1+ (o novo step)
- `grep -c "Conditional validation" commands/check-implementation.md` — deve retornar 0
</validation>

<handoff>
Fase 2 precisa saber: check-project.ts agora roda 1x por fase (no build-phase.md) + 1x no final (check-implementation.md). Builders não rodam mais.
</handoff>
</phase1>

<phase2 name="Fix Naming /devorch + Cleanup">
<goal>Eliminar skill duplicado /devorch:devorch e limpar referências</goal>

<tasks>
#### 1. Excluir devorch.md da cópia para subdiretório
- **ID**: fix-install-copy
- **Assigned To**: builder-1
- Editar `install.ts`:
  - Na função `copyDir` (ou no loop de cópia), adicionar condição para pular `devorch.md` quando o destino é o subdiretório `commands/devorch/`
  - Manter a cópia root-level (lines 81-91) intacta — essa é a que produz `/devorch`
  - Testar que outros arquivos .md continuam sendo copiados normalmente

#### 2. Limpar referências a devorch:devorch
- **ID**: clean-references
- **Assigned To**: builder-2
- Verificar e limpar qualquer referência a `devorch:devorch` no codebase ativo:
  - `.devorch/plans/current.md:113` — este é o plano anterior, vai ser arquivado naturalmente
  - Buscar em README.md, commands/*.md por referências residuais
  - Se encontrar referências, atualizar para `/devorch`

#### 3. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verificar que install.ts exclui devorch.md do subdiretório
- Verificar que a cópia root-level de devorch.md ainda existe
- Verificar que não há referências a `devorch:devorch` no codebase (exceto em planos arquivados)
</tasks>

<execution>
**Wave 1** (parallel): fix-install-copy, clean-references
**Wave 2** (validation): validate-phase-2
</execution>

<criteria>
- [ ] install.ts não copia devorch.md para `~/.claude/commands/devorch/`
- [ ] install.ts mantém cópia de devorch.md para `~/.claude/commands/devorch.md` (root level)
- [ ] Nenhuma referência ativa a `devorch:devorch` no codebase (exceto planos arquivados)
- [ ] Outros arquivos .md continuam sendo copiados para o subdiretório normalmente
</criteria>

<validation>
- `grep -rn "devorch:devorch" commands/ agents/ templates/ scripts/ install.ts README.md` — deve retornar 0 matches
</validation>

<handoff>
Fase 3 precisa saber: check-project.ts não suporta flags ainda (só --timeout e positional dir). Execution order atual: lint+typecheck parallel → build → test sequencial. Validator não recebe check-project results. Smart dispatch re-roda check-project.ts completo após fixes. Explore cross-phase já recebe changed files mas poderia ser mais explícito.
</handoff>
</phase2>

<phase3 name="Otimizações de Performance e Tokens">
<goal>Adicionar --no-test flag e parallelismo total ao check-project.ts, melhorar reuso de cache e contexto para validator/builders, otimizar smart dispatch e Explore cross-phase</goal>

<tasks>
#### 1. check-project.ts: --no-test flag + full parallel
- **ID**: optimize-check-script
- **Assigned To**: builder-1
- Editar `scripts/check-project.ts`:
  - Adicionar parsing de flag `--no-test` no bloco de argumentos (lines 9-20). Quando presente, skip a detecção e execução do check "test"
  - Mudar execution order (lines 139-176): em vez de lint+typecheck parallel → build sequential → test sequential, rodar TODOS os checks detectados em paralelo com `Promise.all`. O resultado é o mesmo (JSON com pass/fail por check), mas tempo total = max(lint, typecheck, build, test) em vez de soma
  - Manter timeouts individuais (60s para lint/typecheck/build, 120s para test)
  - Manter a mesma interface de output (JSON stdout)

#### 2. build-phase.md: --no-test + contexto enriquecido
- **ID**: optimize-phase-template
- **Assigned To**: builder-2
- Editar `templates/build-phase.md`:
  - **Step 4** (check-project.ts): adicionar `--no-test` ao comando. Ficaria: `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --no-test`
  - **Step 2** (Explore): fortalecer instrução — adicionar: "Se o explore-cache contém seções que cobrem TODOS os arquivos em `<relevant-files>` desta fase, NÃO lance Explore agents. Só lance para áreas com cobertura parcial ou inexistente no cache."
  - **Step 3** (deploy builders): ao montar o contexto de cada builder, incluir TODAS as seções do explore-cache relevantes para a fase (não só as task-specific). Isso reduz a necessidade de builders lançarem seus próprios Explore agents.
  - **Step 6** (deploy validator): passar resultado do check-project.ts (step 4) como contexto adicional. Formato: "Automated checks passed: lint ✅, typecheck ✅, build ✅. Focus your verification on semantic/behavioral criteria that automated checks cannot verify."
  - Atualizar instrução do validator para refletir que ele recebe check results

#### 3. check-implementation.md: smart dispatch targeted + Explore focused
- **ID**: optimize-check-impl
- **Assigned To**: builder-3
- Editar `commands/check-implementation.md`:
  - **Step 6d** (re-verify): em vez de re-rodar check-project.ts completo após fix, rodar só checks afetados:
    - Se fix foi lint/formatting → re-rodar só `<pm> lint`
    - Se fix foi código/imports → re-rodar `<pm> lint` + typecheck
    - Se fix tocou lógica de negócio → re-rodar check-project.ts completo
    - Adicionar lógica: "Classify the fix scope: formatting-only, structural, or behavioral. Run the minimum check set that covers the scope."
  - **Explore agent cross-phase** (step 3): adicionar instrução explícita: "Focus ONLY on files listed in the git diff from Step 2. Do NOT read files that were not modified. Use explore-cache for context on unchanged surrounding code."

#### 4. devorch-validator.md: receber check results
- **ID**: update-validator-agent
- **Assigned To**: builder-4
- Editar `agents/devorch-validator.md`:
  - Atualizar line 24 que diz "Do NOT run check-project.ts — builders already validate project health before committing" para: "Do NOT run check-project.ts — automated checks already ran for this phase. Their results are provided in your prompt. Focus on **semantic/behavioral criteria** that automated checks cannot verify."
  - Adicionar na seção de contexto (line 14): mencionar que recebe check-project.ts results
  - Manter a instrução de ser read-only e focar em acceptance criteria

#### 5. Validate Phase
- **ID**: validate-phase-3
- **Assigned To**: validator
- Verificar que check-project.ts aceita --no-test e roda checks em paralelo
- Verificar que build-phase.md passa --no-test ao check-project.ts
- Verificar que build-phase.md passa check results ao validator
- Verificar que check-implementation.md tem smart dispatch targeted
- Verificar que devorch-validator.md menciona receber check results
- Verificar que instruções são consistentes entre build-phase.md e devorch-validator.md
</tasks>

<execution>
**Wave 1** (parallel): optimize-check-script, optimize-phase-template, optimize-check-impl, update-validator-agent
**Wave 2** (validation): validate-phase-3
</execution>

<criteria>
- [ ] check-project.ts aceita flag --no-test e pula teste quando presente
- [ ] check-project.ts roda todos checks detectados em paralelo via Promise.all
- [ ] build-phase.md step 4 usa --no-test no comando check-project.ts
- [ ] build-phase.md step 2 tem instrução explícita para não lançar Explore se cache cobre a fase
- [ ] build-phase.md step 3 passa explore-cache completo da fase aos builders
- [ ] build-phase.md step 6 passa resultado do check-project.ts ao validator
- [ ] check-implementation.md step 6d faz re-check targeted baseado no escopo do fix
- [ ] check-implementation.md Explore agent foca em changed files do git diff
- [ ] devorch-validator.md menciona receber check-project results e focar em critérios semânticos
- [ ] Nenhuma inconsistência entre instruções de build-phase.md e devorch-validator.md
</criteria>

<validation>
- `grep -c "no-test" scripts/check-project.ts` — deve retornar 1+ (flag parsing)
- `grep -c "Promise.all" scripts/check-project.ts` — deve retornar 1+ (parallel execution)
- `grep -c "no-test" templates/build-phase.md` — deve retornar 1+ (passando flag)
- `grep -c "check results" agents/devorch-validator.md` — deve retornar 1+ (menção a receber resultados)
</validation>
</phase3>
