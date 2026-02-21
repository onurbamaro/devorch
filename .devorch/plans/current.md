# Plan: Satellite Worktrees — Multi-Repo Support

<description>
Permitir que planos do devorch criem worktrees em repos secundários ("satélites") quando a feature precisa de mudanças em múltiplos projetos. O projeto principal gerencia plano, estado e orquestração. Satélites recebem apenas worktrees para isolamento, sem arquivos devorch. Merge coordenado no final.
</description>

<objective>
Um plano pode declarar repos secundários via `<secondary-repos>`, tasks podem ser atribuídas a repos específicos via campo `**Repo**`, worktrees são criadas/mergeadas/deletadas em todos os repos de forma coordenada.
</objective>

<classification>
Type: feature
Complexity: medium
Risk: medium
</classification>

<decisions>
- Uma task = um repo. Tasks não cruzam fronteiras de repos.
- Plano declara repos secundários via seção `<secondary-repos>` com nome e path relativo.
- Tasks indicam repo via campo `**Repo**: <nome>` (default: primary).
- Branch com mesmo nome (`devorch/<plan-name>`) em todos os repos.
- Mudanças não commitadas no secundário: só avisar (warning), não bloquear.
- Merge coordenado: validar todos primeiro (dry-run), depois mergear sequencialmente.
- Repo secundário não tem arquivos devorch — só worktree para isolamento.
- Estado dos satélites rastreado no state.md do projeto principal.
</decisions>

<problem-statement>
Quando uma feature envolve mudanças em múltiplos projetos (ex: backend + frontend), o devorch só cria worktree no projeto principal. O secundário é modificado direto na main, o que conflita com outras sessões devorch e não oferece rollback limpo.
</problem-statement>

<solution-approach>
Estender o sistema de worktrees para suportar repos satélite:
1. Nova seção `<secondary-repos>` no formato do plano
2. `setup-worktree.ts` cria worktrees em repos secundários
3. `init-phase.ts` inclui paths dos satélites no contexto dos builders
4. `build-phase.md` deploya builders com working directory correto por task
5. Merge coordenado: dry-run em todos → merge sequencial
6. `list-worktrees.ts` e `worktrees.md` gerenciam satélites junto com primary

Alternativas consideradas:
- Git submodules: rejeitado — over-engineering, devorch não precisa acoplar repos
- Clone separado: rejeitado — git worktree é mais leve e mantém object store compartilhado
- Sem worktree no secundário: rejeitado pelo usuário — main fica exposta a conflitos
</solution-approach>

<relevant-files>
- `scripts/setup-worktree.ts` — criar worktrees em repos secundários
- `scripts/list-worktrees.ts` — listar satélites junto com primary
- `scripts/init-phase.ts` — incluir satellite paths no contexto dos builders
- `scripts/validate-plan.ts` — validar seção secondary-repos
- `scripts/update-state.ts` — rastrear estado dos satélites
- `scripts/lib/git-utils.ts` — funções multi-repo
- `scripts/lib/plan-parser.ts` — parse da nova seção secondary-repos
- `commands/build.md` — merge coordenado no final do build
- `commands/worktrees.md` — merge/delete cascateando para satélites
- `commands/talk.md` — gerar planos com secondary-repos e passar --secondary ao setup-worktree
- `templates/build-phase.md` — deployer builders com repo context
- `agents/devorch-builder.md` — documentar campo Repo e multi-repo awareness

<new-files>
(nenhum arquivo novo — todas as mudanças são em arquivos existentes)
</new-files>
</relevant-files>

<phase1 name="Plan Format e Worktree Setup">
<goal>Plano aceita secondary-repos, setup-worktree cria worktrees em repos satélite, validação verifica repos.</goal>

<tasks>
#### 1. Adicionar parsing de secondary-repos e funções git multi-repo
- **ID**: parse-secondary-repos
- **Assigned To**: builder-1
- Adicionar função `extractSecondaryRepos(planContent): { name: string, path: string }[]` em `scripts/lib/plan-parser.ts`
- Formato no plano: `<secondary-repos>` contendo linhas `- \`name\` — path/relativo/ao/projeto`
- Retornar array vazio se a seção não existir (backwards-compatible)
- Adicionar em `scripts/lib/git-utils.ts`:
  - `checkBranchExists(repoPath: string, branch: string): boolean` — usa `git -C <repoPath> rev-parse --verify <branch>`
  - `getUncommittedFiles(repoPath: string): string[]` — usa `git -C <repoPath> status --porcelain`
  - `isGitRepo(repoPath: string): boolean` — usa `git -C <repoPath> rev-parse --git-dir`

#### 2. Estender setup-worktree para repos secundários
- **ID**: setup-satellite-worktrees
- **Assigned To**: builder-2
- Adicionar flag `--secondary <json>` ao `scripts/setup-worktree.ts`
- JSON é array: `[{"name":"backend","path":"../backend"}]`
- Para cada secundário:
  - Resolver path absoluto relativo ao cwd
  - Validar que é git repo via `isGitRepo()` — error se não for
  - Checar se branch `devorch/<name>` já existe via `checkBranchExists()` — error se existir
  - Checar mudanças não commitadas via `getUncommittedFiles()` — warning em stderr, continuar
  - Criar worktree: `git -C <repoPath> worktree add <repoPath>/.worktrees/<name> -b devorch/<name>`
  - Garantir `.worktrees/` no `.gitignore` do secundário
- Output JSON atualizado: adicionar campo `satellites: [{ name, repoPath, worktreePath, branch, warnings: string[] }]`
- Sem `--secondary`, output idêntico ao atual (sem campo satellites)

#### 3. Validar secondary-repos no validate-plan
- **ID**: validate-secondary-repos
- **Assigned To**: builder-3
- Em `scripts/validate-plan.ts`, usar `extractSecondaryRepos()` para parsear plano
- Validações:
  - Nomes de repos são únicos
  - Nenhum nome é "primary" (reservado)
  - Tasks com campo `**Repo**: <name>` — name deve existir em secondary-repos
  - Tasks sem campo `**Repo**` são válidas (default: primary)
- Adicionar warnings (não block) se paths não parecem caminhos relativos válidos
- Tasks de repos diferentes na mesma wave: permitido (não compartilham arquivos)

#### 4. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify acceptance criteria
- Run validation commands
</tasks>

<execution>
**Wave 1** (parallel): parse-secondary-repos, validate-secondary-repos
**Wave 2** (after wave 1): setup-satellite-worktrees
**Wave 3** (validation): validate-phase-1
</execution>

<criteria>
- [ ] `extractSecondaryRepos()` parseia corretamente a seção e retorna array tipado
- [ ] `checkBranchExists()`, `getUncommittedFiles()`, `isGitRepo()` funcionam em qualquer repo path
- [ ] `setup-worktree.ts --secondary '[...]'` cria worktrees nos repos indicados
- [ ] Warning em stderr se repo secundário tem mudanças não commitadas
- [ ] Error se branch `devorch/<name>` já existe no secundário
- [ ] Error se path não é um git repo
- [ ] `validate-plan.ts` valida nomes e referências de repo em tasks
- [ ] Sem `--secondary`, comportamento idêntico ao atual (backwards-compatible)
</criteria>

<validation>
- `bun scripts/validate-plan.ts --plan .devorch/plans/current.md` — plano válido
</validation>

<handoff>
Phase 1 entrega: plan-parser com extractSecondaryRepos(), git-utils com funções multi-repo, setup-worktree com --secondary, validate-plan com checagem de repos. Phase 2 integra no build pipeline (init-phase, build-phase, builder agent).
</handoff>
</phase1>

<phase2 name="Build Pipeline Integration">
<goal>Builders recebem contexto de satélites e executam tasks no repo correto.</goal>

<tasks>
#### 1. Incluir satélites no init-phase
- **ID**: init-phase-satellites
- **Assigned To**: builder-1
- Em `scripts/init-phase.ts`, usar `extractSecondaryRepos()` para parsear plano
- Adicionar campo `satellites` no JSON de output: `[{ name: string, path: string }]`
- Parsear campo `**Repo**` de cada task no conteúdo da fase (regex: `\*\*Repo\*\*:\s*(.+)`)
- Default "primary" se campo ausente
- Incluir `repo` field em cada task no output: `{ id, assignedTo, repo, content }`
- Resolver paths relativos dos satélites em relação ao projectRoot
- Para satélites: resolver worktree path como `<satelliteRepoPath>/.worktrees/<worktreeName>`
  - O worktreeName é derivado do branch name (parte após `devorch/`)

#### 2. Atualizar build-phase para multi-repo
- **ID**: build-phase-multi-repo
- **Assigned To**: builder-2
- Em `templates/build-phase.md`, no step de deploy builders:
  - Quando init-phase output inclui `satellites` array, informar builders sobre repos disponíveis
  - Para cada task com `repo` != "primary": adicionar ao prompt do builder:
    - "Working directory: `<satellite-worktree-path>`"
    - "All file operations and git commands must use this directory as root"
    - "Use `git -C <path>` for all git commands"
  - Para tasks com `repo` == "primary" (ou sem repo): comportamento atual (projectRoot)
- No step de phase commit: commitar em CADA repo que teve tasks nesta fase
  - Primary: como hoje
  - Cada satélite que teve tasks: `git -C <satellite-worktree-path> add -A && git -C <satellite-worktree-path> commit -m "<phase commit message>"`

#### 3. Documentar multi-repo no builder agent
- **ID**: builder-multi-repo-docs
- **Assigned To**: builder-3
- Em `agents/devorch-builder.md`, adicionar seção "Multi-repo tasks" nas rules:
  - Quando o prompt incluir "Working directory: `<path>`", usar esse path como raiz para todas as operações
  - Todas as operações de arquivo (Read, Write, Edit, Glob, Grep) devem usar paths dentro do working directory
  - Git commands: usar `git -C <working-directory>` se working directory difere do cwd
  - Nunca editar arquivos fora do working directory declarado
  - Commit acontece no repo do working directory

#### 4. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verify acceptance criteria
- Run validation commands
</tasks>

<execution>
**Wave 1** (parallel): init-phase-satellites, builder-multi-repo-docs
**Wave 2** (after wave 1): build-phase-multi-repo
**Wave 3** (validation): validate-phase-2
</execution>

<criteria>
- [ ] `init-phase.ts` output inclui `satellites` array com paths resolvidos
- [ ] `init-phase.ts` output inclui `repo` field por task (default: "primary")
- [ ] `build-phase.md` passa working directory correto ao builder para tasks de satélite
- [ ] `build-phase.md` commita em cada repo que teve tasks na fase
- [ ] Tasks sem campo Repo continuam funcionando no primary (backwards-compatible)
- [ ] `devorch-builder.md` documenta comportamento multi-repo
</criteria>

<validation>
- `bun scripts/init-phase.ts --plan .devorch/plans/current.md --phase 1 2>&1 | head -5` — output JSON válido
</validation>

<handoff>
Phase 2 entrega: builders executam tasks no repo correto, commits por repo. Phase 3 integra merge coordenado e gestão de worktrees satélite.
</handoff>
</phase2>

<phase3 name="Merge Coordenado e Gestão de Worktrees">
<goal>Merge dry-run + sequencial em todos os repos, list/delete/merge de satélites no worktrees command, talk.md atualizado.</goal>

<tasks>
#### 1. Merge coordenado no build.md
- **ID**: coordinated-merge
- **Assigned To**: builder-1
- Em `commands/build.md`, na etapa de merge (step 4):
  - Ler satélites do plano via `extractSecondaryRepos()` (ou equivalente — parsear `<secondary-repos>` do plano)
  - Se plano tem satélites:
    - Resolver worktree paths de cada satélite
    - **Dry-run**: para cada repo (primary + satélites), executar `git -C <repo-main> merge --no-commit --no-ff <branch>` seguido de `git -C <repo-main> merge --abort`
    - Se algum dry-run falha: reportar qual repo e parar (não mergear nenhum)
    - Se todos passam: mergear sequencialmente (primary primeiro, depois satélites em ordem)
    - Cleanup: remover worktree + branch em cada repo
  - Se plano não tem satélites: comportamento atual (sem mudança)
- Atualizar `scripts/update-state.ts` para aceitar `--satellites <json>` e incluir no state.md:
  ```
  ## Satellites
  - backend: complete
  - frontend: complete
  ```

#### 2. Listar e gerenciar satélites no worktrees command
- **ID**: worktrees-satellite-management
- **Assigned To**: builder-2
- Em `scripts/list-worktrees.ts`: para cada worktree listada, ler o plano e extrair secondary-repos
  - Verificar se cada satélite worktree existe (path + git worktree list no repo do satélite)
  - Adicionar campo `satellites: [{ name, repoPath, worktreePath, branch, exists }]` por worktree no output
  - Se não há `<secondary-repos>` no plano: `satellites` é array vazio
- Em `commands/worktrees.md`:
  - Na listagem: mostrar satélites abaixo de cada worktree (indentado)
  - No delete: deletar worktree + branch no primary E em cada satélite existente
  - No merge: usar lógica de merge coordenado (dry-run primeiro, depois sequencial)

#### 3. Atualizar talk.md e fix.md para secondary-repos
- **ID**: talk-secondary-repos
- **Assigned To**: builder-3
- Em `commands/talk.md`:
  - Na seção Plan Format, documentar tag `<secondary-repos>` dentro de `<relevant-files>`:
    ```xml
    <secondary-repos>
    - `name` — relative/path/to/repo
    </secondary-repos>
    ```
  - Documentar campo `**Repo**: <name>` como campo opcional de tasks (default: primary)
  - No step de setup-worktree (step 7), quando plano tem secondary-repos:
    - Parsear a seção e construir JSON array
    - Passar `--secondary '<json>'` ao `setup-worktree.ts`
    - Parse output para incluir satellite paths no report
  - Na clarificação (step 3): quando tarefa menciona múltiplos projetos/repos, perguntar quais repos secundários envolver
- Em `commands/fix.md`: sem mudança — fix opera num único repo

#### 4. Validate Phase
- **ID**: validate-phase-3
- **Assigned To**: validator
- Verify acceptance criteria
- Run validation commands
</tasks>

<execution>
**Wave 1** (parallel): coordinated-merge, talk-secondary-repos
**Wave 2** (after wave 1): worktrees-satellite-management
**Wave 3** (validation): validate-phase-3
</execution>

<criteria>
- [ ] Merge coordenado: dry-run em todos os repos antes de mergear qualquer um
- [ ] Se dry-run falha em qualquer repo, nenhum é mergeado
- [ ] Cleanup remove worktree + branch em todos os repos
- [ ] `update-state.ts` registra status dos satélites
- [ ] `list-worktrees.ts` mostra satélites de cada worktree com status exists/missing
- [ ] Delete de worktree cascateia para satélites
- [ ] Merge de worktree usa lógica coordenada
- [ ] `talk.md` documenta `<secondary-repos>` e `**Repo**` no plan format
- [ ] `talk.md` passa `--secondary` ao setup-worktree quando plano tem repos secundários
- [ ] Planos sem secondary-repos funcionam identicamente ao comportamento atual
</criteria>

<validation>
- `bun scripts/list-worktrees.ts 2>&1 | head -20` — output JSON válido
- `bun scripts/validate-plan.ts --plan .devorch/plans/current.md` — plano válido
</validation>
</phase3>
