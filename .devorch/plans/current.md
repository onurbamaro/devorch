# Plan: Merge Stash Pre-flight — Working Tree Sujo

<description>
Adicionar pre-flight check de stash no step 4 (Merge worktree) do build.md para lidar com repos que têm uncommitted changes antes do merge. Resolve o problema de dry-run falhando com "Your local changes would be overwritten" e conflitos de stash pop pós-merge.
</description>

<objective>
O step de merge do build.md funciona corretamente mesmo quando primary e/ou satellites têm uncommitted changes — fazendo stash automático, merge, pop, e reportando conflitos ao usuário sem perda de código.
</objective>

<classification>
Type: Enhancement
Complexity: Simple
Risk: Low
</classification>

<decisions>
- Conflito de stash pop → NÃO auto-resolver. Reportar arquivos em conflito ao usuário para decisão manual. Motivo: usuário pode ter mudanças locais valiosas feitas com Claude Code direto (sem devorch).
- Filtro de dirty → apenas tracked files (ignorar linhas `??` do `git status --porcelain`). Untracked files não atrapalham merge.
- Falha no dry-run após stash → `merge --abort` + `stash pop` para restaurar estado original. Reportar conflito entre branches.
- Multi-repo → stash todos os repos antes dos dry-runs (atomicidade no check), pop todos após merge bem-sucedido.
- Escopo → apenas build.md seção 4. Nenhum script .ts alterado.
</decisions>

<problem-statement>
O step de merge assume working tree limpo em todos os repos. Na prática, o main branch pode ter changes de trabalho feito com Claude Code direto ou edições manuais. O dry-run falha, forçando stash manual e resolução de conflitos sem documentação.
</problem-statement>

<solution-approach>
Inserir um sub-step "Pre-flight: stash dirty repos" antes dos dry-runs no step 4 do build.md. O fluxo passa a ser: check dirty → stash se necessário → dry-run → merge → pop → reportar conflitos. Aplicável tanto ao fluxo com satellites quanto sem.

Alternativas consideradas:
- Auto-resolver com `--ours`: descartado porque pode perder código do usuário
- Abortar merge se dirty: muito restritivo, o stash resolve naturalmente
- `--include-untracked`: descartado por risco de stashar build artifacts
</solution-approach>

<relevant-files>
- `commands/build.md` — arquivo alvo, seção 4 "Merge worktree" (linhas ~134-181)

<new-files>
(nenhum)
</new-files>
</relevant-files>

<phase1 name="Pre-flight Stash no Merge">
<goal>Adicionar lógica de stash automático ao step 4 do build.md para lidar com working tree sujo</goal>

<tasks>
#### 1. Adicionar Pre-flight Stash ao Merge
- **ID**: add-stash-preflight
- **Assigned To**: builder-1
- Na seção `### 4. Merge worktree` do `commands/build.md`, inserir entre o passo 4 (AskUserQuestion) e o bloco `If **merge**:` um novo sub-step "Pre-flight: stash dirty repos"
- O sub-step deve:
  - Para cada repo (primary + satellites detectados no passo 3):
    - Rodar `git -C <repoMainPath> status --porcelain` e filtrar linhas que NÃO começam com `??`
    - Se houver mudanças tracked: `git -C <repoMainPath> stash push -m "devorch-pre-merge"` e registrar que aquele repo foi stashed
    - Se não houver mudanças tracked: pular stash, registrar que repo está limpo
  - Reportar: "Stashed changes in N repos: <list>" ou "All repos clean, proceeding."
- Modificar o bloco **"With satellites (coordinated merge)"** step a (dry-run):
  - O dry-run agora roda APÓS o stash, então working tree está limpo
  - Se dry-run falhar: para cada repo que foi stashed, rodar `git -C <repoMainPath> stash pop`. Reportar conflito entre branches e parar
- Após o bloco de merge (step b), antes do cleanup (step c), adicionar "Restore stashed changes":
  - Para cada repo que foi stashed: `git -C <repoMainPath> stash pop`
  - Se pop falhar (exit code != 0): rodar `git -C <repoMainPath> status --porcelain` para listar arquivos em conflito. Reportar ao usuário: "Stash pop conflict in <repo>: <file list>. Resolve manually with `git mergetool` or edit the files, then `git add` and `git stash drop`." Parar — NÃO continuar cleanup dos outros repos
  - Se pop suceder: stash é auto-removido, continuar
- Aplicar a mesma lógica ao bloco **"Without satellites"** (standard merge): stash antes, pop depois, mesma tratativa de conflito
- Manter estilo existente: prosa imperativa, variáveis em `<angleBrackets>`, comandos inline em backticks, blocos bash para sequências multi-linha

#### 2. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verificar que build.md tem a seção de pre-flight stash inserida corretamente
- Verificar que o fluxo cobre: stash → dry-run → merge → pop → cleanup
- Verificar que conflitos de pop são reportados sem auto-resolução
- Verificar que rollback (abort + pop) está documentado para falha de dry-run
- Verificar que multi-repo é tratado (stash todos antes, pop todos depois)
- Verificar que nenhum script .ts foi alterado
</tasks>

<execution>
**Wave 1**: add-stash-preflight
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] Seção 4 do build.md contém sub-step de pre-flight stash antes dos dry-runs
- [ ] Filtro de dirty usa `git status --porcelain` excluindo linhas `??`
- [ ] Stash usa `git stash push -m "devorch-pre-merge"` (tracked only)
- [ ] Após merge: stash pop com tratativa de conflito (reportar, não auto-resolver)
- [ ] Falha no dry-run: abort + pop para restaurar estado
- [ ] Multi-repo: stash todos antes dos dry-runs, pop todos após merge
- [ ] Fluxo sem satellites também tem stash/pop
- [ ] Nenhum script .ts foi modificado
</criteria>

<validation>
- `grep -c "devorch-pre-merge" commands/build.md` — deve retornar >= 1
- `grep -c "stash pop" commands/build.md` — deve retornar >= 1
- `git diff --name-only` — deve mostrar apenas `commands/build.md`
</validation>
</phase1>
