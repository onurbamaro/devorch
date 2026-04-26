# Plan: Devorch File Lifecycle Cleanup

<description>
Adicionar gestão de ciclo de vida aos arquivos que o devorch gera (.devorch/), incluindo cleanup automático após merge, remoção de persistência desnecessária, exibição completa da estrutura do projeto, e política zero-tolerance para erros de lint/typecheck nos builders.
</description>

<objective>
Após merge de worktree: current.md é arquivado, state.md é deletado, explore-cache.md é wipado. O map-project.ts mostra estrutura completa sem truncação. O talk não persiste project-map.md em disco. Builders recebem o mapa do projeto no contexto do init-phase com indicação de que é up-to-date. Builders corrigem TODOS os erros de lint/typecheck (inclusive pré-existentes) — zero tolerance.
</objective>

<classification>
Type: Enhancement
Complexity: Simple
Risk: Low
</classification>

<decisions>
- Pós-merge de worktree → arquivar plans/current.md em plans/archive/ e deletar state.md
- explore-cache.md → wipe completo após merge (manter trim/invalidate durante build como está)
- project-map.md → remover --persist do talk.md (arquivo não precisa existir)
- map-project.ts → remover limites de 5 arquivos por diretório e profundidade máx 2
- Builders recebem project map no contexto do init-phase.ts, gerado na hora (subprocesso), com header indicando que é up-to-date para evitar re-scan
- Zero-tolerance para lint/typecheck → builder corrige TODOS os erros (inclusive pré-existentes). Se não conseguir, phase bloqueia e reporta ao usuário
</decisions>

<relevant-files>
- `commands/build.md` — step de merge precisa de lógica de cleanup pós-merge
- `commands/talk.md` — remover --persist do map-project.ts call
- `scripts/map-project.ts` — remover truncação de arquivos e limite de profundidade
- `scripts/init-phase.ts` — adicionar execução do map-project.ts e incluir output no contexto dos builders
- `scripts/archive-plan.ts` — já existe, será usado no pós-merge
- `templates/build-phase.md` — remover escape clause de erros pré-existentes (lines 48-49, 63-64)
- `agents/devorch-builder.md` — adicionar instrução zero-tolerance

<new-files>
(nenhum)
</new-files>
</relevant-files>

<phase1 name="Cleanup, Map Completo e Zero-Tolerance">
<goal>Adicionar cleanup pós-merge, remover truncação do map-project, incluir mapa no contexto dos builders e enforçar zero-tolerance para lint/typecheck</goal>

<tasks>
#### 1. Adicionar cleanup pós-merge ao build.md
- **ID**: post-merge-cleanup
- **Assigned To**: builder-merge
- No step de merge do `commands/build.md`, após merge bem-sucedido e antes de deletar a worktree:
  - Rodar `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan <worktreePath>/.devorch/plans/current.md` para arquivar o plano no main repo
  - Deletar `.devorch/state.md` do main repo se existir (veio do merge)
  - Deletar `.devorch/explore-cache.md` do main repo (wipe completo)
  - Deletar `.devorch/project-map.md` do main repo se existir
  - Commitar as remoções com mensagem `chore(devorch): cleanup post-merge <plan-name>`
- Manter a mesma estrutura de prose/formatação do build.md existente

#### 2. Remover --persist e truncação do map-project
- **ID**: map-project-fullstructure
- **Assigned To**: builder-map
- Em `commands/talk.md` Step 1: trocar `bun $CLAUDE_HOME/devorch-scripts/map-project.ts --persist` por `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` (sem --persist)
- Em `scripts/map-project.ts`:
  - Line 122-127: remover o `slice(0, 5)` e o bloco `if (files.length > 5)` — listar todos os arquivos
  - Line 109: remover o `if (depth > 2) return;` — percorrer toda a profundidade

#### 3. Incluir project map no contexto dos builders
- **ID**: init-phase-project-map
- **Assigned To**: builder-init
- Em `scripts/init-phase.ts`:
  - Adicionar execução de `map-project.ts` como subprocesso via `Bun.spawn()`: `bun <scriptDir>/map-project.ts` rodando no `projectRoot`
  - Capturar o stdout (output markdown)
  - Inserir no array `parts` como nova seção, **após "Current State" e antes de "Explore Cache"**, com o seguinte formato:
    ```
    ## Project Structure
    > Fresh snapshot — generated at phase init. Trust this as the current project layout.

    <output do map-project.ts>
    ```
  - O header "Fresh snapshot" instrui explicitamente o builder a não gastar tokens re-listando a estrutura
  - Se o subprocesso falhar (exit code != 0), ignorar silenciosamente — o map é contexto opcional

#### 4. Enforçar zero-tolerance para lint/typecheck
- **ID**: zero-tolerance-lint
- **Assigned To**: builder-lint
- Em `templates/build-phase.md`:
  - Lines 48-49: substituir as 2 linhas que distinguem "files modified in this phase" vs "pre-existing issues" por uma única regra: `"If lint/typecheck fail: fix ALL errors (including pre-existing). If unable to fix after one retry, report the errors and block the phase — do not proceed."`
  - Lines 63-64: mesma substituição para o bloco de satellites
- Em `agents/devorch-builder.md`:
  - Na seção de regras/instruções, adicionar: `"Zero-tolerance policy: you are responsible for leaving the project with zero lint, typecheck, and build errors. This includes pre-existing errors — fix them. If you cannot fix an error, block and report it. Never dismiss errors as 'pre-existing'."`
- Em `commands/build.md`:
  - Lines 48-51: substituir a lógica permissiva de avaliação por: `"If lint/typecheck fail: the builder must fix ALL errors. If validation.failed > 0: the builder must fix or the phase blocks."`

#### 5. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verificar que build.md contém lógica de archive + delete state + wipe cache após merge
- Verificar que map-project.ts não tem limites de truncação
- Verificar que talk.md não usa --persist
- Verificar que init-phase.ts roda map-project.ts e inclui output com header "Fresh snapshot"
- Verificar que build-phase.md NÃO contém "pre-existing" ou "log as warning and proceed" para lint/typecheck
- Verificar que devorch-builder.md contém instrução de zero-tolerance
- Verificar que build.md não permite prosseguir com erros de lint/typecheck
- Rodar `bun scripts/map-project.ts` e confirmar que estrutura completa aparece
</tasks>

<execution>
**Wave 1** (parallel): post-merge-cleanup, map-project-fullstructure, init-phase-project-map
**Wave 2** (after wave 1): zero-tolerance-lint
**Wave 3** (validation): validate-phase-1
</execution>

<criteria>
- [ ] build.md archiva current.md e deleta state.md + explore-cache.md após merge bem-sucedido
- [ ] talk.md chama map-project.ts sem --persist
- [ ] map-project.ts lista todos os arquivos sem truncação `+N files`
- [ ] map-project.ts percorre todos os níveis de profundidade
- [ ] init-phase.ts roda map-project.ts e inclui output no contexto dos builders com header "Fresh snapshot"
- [ ] build-phase.md não tem escape clause para erros pré-existentes
- [ ] devorch-builder.md contém instrução zero-tolerance
- [ ] build.md não permite prosseguir com lint/typecheck falhando
</criteria>

<validation>
- `bun scripts/map-project.ts` — deve mostrar estrutura completa sem `... +N files`
- `grep -c "persist" commands/talk.md` — deve retornar 0
- `grep -c "slice" scripts/map-project.ts` — deve retornar 0 (no contexto de file listing)
- `grep -c "depth > 2" scripts/map-project.ts` — deve retornar 0
- `grep -c "Project Structure" scripts/init-phase.ts` — deve retornar >= 1
- `grep -c "map-project" scripts/init-phase.ts` — deve retornar >= 1
- `grep -ic "pre-existing" templates/build-phase.md` — deve retornar 0
- `grep -c "zero-tolerance" agents/devorch-builder.md` — deve retornar >= 1
</validation>
</phase1>
