# Plan: Otimizar Performance do Build + Fix Naming /devorch

<description>
Reduz tempo de build de ~1h para ~25-35min movendo check-project.ts de per-task (N execuções) para per-phase (1x por fase) + 1x no final. Remove validação redundante (conditional re-run). Corrige duplicação do skill `/devorch:devorch` eliminando a cópia extra no install.ts.
</description>

<objective>
Build de 4 fases executa check-project.ts no máximo 5x (1 por fase + 1 final) em vez de ~11x. Skill `/devorch:devorch` não existe mais — apenas `/devorch`.
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
- `templates/build-phase.md` — workflow de fase, precisa inserir check-project.ts após builders
- `commands/check-implementation.md` — conditional re-run a remover, report template a atualizar
- `install.ts` — copyDir copia devorch.md para subdiretório (excluir)
- `commands/devorch.md` — verificar referências a devorch:devorch

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
</phase2>
