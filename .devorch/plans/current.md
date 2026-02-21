# Plan: Robust Multi-Repo — Worktree Resilience + Build Validation

<description>
Tornar o fluxo multi-repo do devorch robusto de ponta a ponta: setup-worktree.ts ganha --recreate e --add-secondary, map-project.ts detecta repos irmãos automaticamente, e o build pipeline valida satellites corretamente.
</description>

<objective>
(1) setup-worktree.ts aceita --recreate (safe delete com branch -d) e --add-secondary em worktree existente.
(2) map-project.ts detecta repos irmãos com .git próprio e reporta em seção dedicada.
(3) talk.md usa a detecção de sibling repos para montar perguntas de --secondary automaticamente.
(4) init-phase.ts valida campo repo dos tasks contra satellites. build-phase.md roda check-project em satellites. Coleta de status explícita.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: low
</classification>

<decisions>
- --recreate: usar git branch -d (safe delete) em vez de -D → Sim, falhar se branch tem commits não-merged
- --add-secondary: criar branch nova com mesmo nome (devorch/<name>) no repo secundário → Sim
- Detecção de sibling repos: subir 1 nível do cwd, listar diretórios irmãos, checar .git → Sim
- Output de sibling repos: nova seção "## Sibling Repos" no map-project.ts → Sim
- Incluir fixes do build multi-repo no mesmo plano → Sim
</decisions>

<problem-statement>
Quando um projeto usa múltiplos repos git no mesmo monorepo (ex: packages/web e packages/core com .git separados), o devorch falha em cascata: (1) setup-worktree.ts não permite recriar worktrees existentes nem adicionar satellites depois, (2) map-project.ts não detecta repos irmãos, forçando descoberta tardia, (3) o build pipeline não valida tasks com campo repo contra satellites existentes e não roda check-project em repos secundários.
</problem-statement>

<solution-approach>
3 frentes paralelas que se complementam:

1. **setup-worktree.ts robusto**: --recreate faz worktree remove + branch -d + recria (falha se branch tem commits não-merged). --add-secondary aceita worktree existente e só cria satellites novos no repo secundário com a mesma branch.

2. **map-project.ts com detecção**: Subir 1 nível do cwd, listar diretórios irmãos, checar quais têm .git próprio (via git rev-parse --git-dir). Reportar em seção "## Sibling Repos" no output Markdown. talk.md parseia essa seção para oferecer satellites na pergunta de --secondary.

3. **Build pipeline validado**: init-phase.ts valida repo field dos tasks contra array de satellites (exit 1 se mismatch). build-phase.md roda check-project.ts uma vez por satellite com tasks naquela fase. Coleta de status usa scan explícito de tasks por repo field.

Alternativa descartada: detecção recursiva até monorepo root — complexidade alta, pouco ganho sobre parent+siblings.
Alternativa descartada: --recreate com branch -D (force delete) — pode destruir trabalho não-merged silenciosamente.
</solution-approach>

<relevant-files>
- `scripts/setup-worktree.ts` — receberá --recreate e --add-secondary
- `scripts/map-project.ts` — receberá detecção de sibling repos
- `scripts/lib/git-utils.ts` — funções git reutilizáveis (checkBranchExists, isGitRepo)
- `scripts/lib/plan-parser.ts` — extractSecondaryRepos (usado por init-phase e list-worktrees)
- `scripts/init-phase.ts` — receberá validação do campo repo vs satellites
- `scripts/check-project.ts` — já aceita diretório como argumento posicional
- `templates/build-phase.md` — receberá loop de check-project em satellites + coleta explícita de status
- `commands/talk.md` — receberá integração com seção Sibling Repos do map-project

<new-files>
- nenhum — todas as mudanças são em arquivos existentes
</new-files>
</relevant-files>

<phase1 name="setup-worktree.ts: --recreate e --add-secondary">
<goal>Adicionar flags --recreate e --add-secondary ao setup-worktree.ts para permitir recriação segura e adição incremental de satellites</goal>

<tasks>
#### 1. Implementar --recreate
- **ID**: implement-recreate
- **Assigned To**: builder-worktree
- Adicionar flag `--recreate` (boolean) ao parseArgs do setup-worktree.ts
- Quando --recreate é passado E a worktree já existe:
  1. Executar `git worktree remove <worktreePath>` (sem --force)
  2. Executar `git branch -d devorch/<name>` (safe delete — falha se não-merged)
  3. Se branch -d falha: exit 1 com mensagem "Branch devorch/<name> has unmerged commits. Use git branch -D to force delete."
  4. Se ambos ok: continuar com criação normal
- Quando --recreate é passado mas worktree NÃO existe: ignorar (continuar criação normal)
- Quando --recreate NÃO é passado: comportamento idêntico ao atual (exit 1 se worktree existe)
- Mesma lógica para satellites: se satellite worktree existe com --recreate, remover worktree + branch -d antes de recriar

#### 2. Implementar --add-secondary
- **ID**: implement-add-secondary
- **Assigned To**: builder-worktree
- Adicionar flag `--add-secondary` (string, JSON) ao parseArgs do setup-worktree.ts
- Quando --add-secondary é passado:
  1. Worktree principal DEVE existir (exit 1 se não existe, com mensagem "Worktree <name> does not exist. Use --secondary for initial creation.")
  2. Branch devorch/<name> DEVE existir (já foi criada com a worktree principal)
  3. Para cada repo no JSON: criar satellite worktree com `git -C <repoPath> worktree add <satPath> -b devorch/<name>`
  4. NÃO recriar worktree principal, NÃO copiar .devorch, NÃO mexer em .gitignore do main repo
  5. Validação de cada satellite: isGitRepo, checkBranchExists (falha se branch já existe naquele repo), warn uncommitted
  6. Ensure .gitignore no satellite repo
- Output: JSON com satellites array (sem worktreePath do principal, já que não foi criado)
- --add-secondary e --secondary são mutuamente exclusivos (exit 1 se ambos passados)

#### 3. Validar setup-worktree.ts
- **ID**: validate-phase-1
- **Assigned To**: validator
- Testar --recreate: criar worktree, depois chamar com --recreate e verificar recriação sem erro
- Testar --recreate com branch que tem commits: verificar que falha com mensagem clara
- Testar --add-secondary: criar worktree sem satellite, depois adicionar via --add-secondary
- Testar --add-secondary em worktree inexistente: verificar exit 1
- Testar --secondary e --add-secondary juntos: verificar exit 1
- Testar comportamento sem flags novas: verificar que nada mudou
</tasks>

<execution>
**Wave 1** (parallel): implement-recreate, implement-add-secondary
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] --recreate remove worktree + branch -d e recria com sucesso
- [ ] --recreate falha graciosamente se branch tem commits não-merged (exit 1 com mensagem)
- [ ] --recreate em worktree inexistente não falha (no-op, continua criação normal)
- [ ] --add-secondary cria satellites em worktree existente sem tocar no principal
- [ ] --add-secondary falha se worktree principal não existe
- [ ] --add-secondary e --secondary mutuamente exclusivos
- [ ] Sem --recreate e sem --add-secondary: comportamento 100% idêntico ao atual
</criteria>

<validation>
- `bun scripts/setup-worktree.ts 2>&1 | head -5` — mostra erro de argumento obrigatório
</validation>

<handoff>
setup-worktree.ts robusto com --recreate e --add-secondary. Próxima fase: detecção de sibling repos no map-project.ts e integração no talk.md.
</handoff>
</phase1>

<phase2 name="map-project.ts: detecção de sibling repos + talk.md">
<goal>map-project.ts detecta repos irmãos automaticamente e talk.md usa essa informação para oferecer satellites</goal>

<tasks>
#### 1. Adicionar detecção de sibling repos ao map-project.ts
- **ID**: detect-sibling-repos
- **Assigned To**: builder-detection
- Adicionar função `detectSiblingRepos(cwd: string): SiblingRepo[]` ao map-project.ts
- Lógica:
  1. Obter parent dir: `resolve(cwd, "..")`
  2. Listar diretórios no parent (readdirSync)
  3. Filtrar: ignorar o próprio cwd, ignorar node_modules/.git/hidden dirs
  4. Para cada diretório irmão: checar se é git repo com `git -C <path> rev-parse --git-dir` (via Bun.spawnSync)
  5. Se é git repo: coletar nome do diretório e path relativo ao cwd
- Adicionar seção "## Sibling Repos" ao output Markdown:
  ```
  ## Sibling Repos
  - `core` — ../core (branch: main)
  - `shared` — ../shared (branch: main)
  ```
- Para cada sibling repo detectado: incluir branch atual via `git -C <path> branch --show-current`
- Seção só aparece se há pelo menos 1 sibling repo (não mostrar seção vazia)
- Posicionar seção depois de "## Recent Commits" e antes do final

#### 2. Integrar detecção no talk.md
- **ID**: integrate-talk-md
- **Assigned To**: builder-docs
- No Step 3 (Clarify) do commands/talk.md:
  - Adicionar instrução: "Se o output do map-project.ts contém seção '## Sibling Repos', incluir uma pergunta sobre quais repos devem ser satellites"
  - A pergunta deve listar os repos detectados como opções (nome + path relativo)
  - Incluir opção "Nenhum — só o repo principal"
- No Step 7 (Create plan):
  - Quando o usuário seleciona repos irmãos como satellites, o orchestrator deve:
    1. Incluir `<secondary-repos>` no plano com os repos selecionados
    2. Passar `--secondary` ao setup-worktree.ts com o JSON correspondente

#### 3. Validar detecção e integração
- **ID**: validate-phase-2
- **Assigned To**: validator
- Rodar map-project.ts no diretório do devorch e verificar output
- Verificar que a seção Sibling Repos só aparece quando há repos irmãos
- Verificar que talk.md tem as instruções de integração com detecção
</tasks>

<execution>
**Wave 1** (parallel): detect-sibling-repos, integrate-talk-md
**Wave 2** (validation): validate-phase-2
</execution>

<criteria>
- [ ] map-project.ts detecta repos irmãos com .git próprio
- [ ] Seção "## Sibling Repos" aparece no output com nome e path relativo
- [ ] Seção não aparece quando não há sibling repos
- [ ] talk.md Step 3 inclui instrução para perguntar sobre satellites quando sibling repos detectados
- [ ] talk.md Step 7 inclui instrução para montar --secondary a partir de repos selecionados
</criteria>

<validation>
- `bun scripts/map-project.ts 2>/dev/null | grep -c "Sibling"` — verifica presença/ausência da seção
</validation>

<handoff>
Detecção de sibling repos funcional e integrada ao talk.md. Próxima fase: fixes do build pipeline multi-repo.
</handoff>
</phase2>

<phase3 name="Build pipeline: validação multi-repo">
<goal>init-phase.ts valida campo repo dos tasks, build-phase.md roda check-project em satellites e coleta status explicitamente</goal>

<tasks>
#### 1. Validar campo repo no init-phase.ts
- **ID**: validate-repo-field
- **Assigned To**: builder-pipeline
- No init-phase.ts, após parsear todos os tasks (depois do loop de extração):
  1. Coletar todos os valores únicos de `repo` dos tasks (exceto "primary" e undefined)
  2. Validar cada valor contra o array `satellites` por nome
  3. Se algum task referencia um repo que não está em satellites: exit 1 com mensagem "Task '<task-id>' references repo '<repo-name>' but no satellite with that name exists. Available satellites: <names>"
- Também validar que cada satellite worktree path existe no filesystem:
  1. Para cada satellite: checar se `existsSync(satellite.worktreePath)`
  2. Se não existe: exit 1 com mensagem "Satellite worktree for '<name>' not found at <path>. Run setup-worktree.ts with --add-secondary to create it."

#### 2. Atualizar build-phase.md para multi-repo validation
- **ID**: update-build-phase-multirepo
- **Assigned To**: builder-docs
- Na seção de validação pós-wave do build-phase.md:
  1. Após rodar check-project no repo primário, adicionar loop para satellites:
     - Determinar quais satellites tiveram tasks nesta fase (scan tasks, coletar repos únicos != primary)
     - Para cada satellite com tasks: rodar `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <satellite.worktreePath>` (sem --with-validation, só lint/typecheck/build)
     - Agregar resultados: se qualquer satellite falha, reportar qual falhou e por quê
  2. Na seção de commit pós-fase:
     - Substituir lógica implícita por scan explícito: "Para cada satellite no array satellites do init-phase output, verificar se tem mudanças com `git -C <satellite.worktreePath> status --porcelain`"
     - Construir JSON de satellites status programaticamente em vez de manualmente
  3. Na seção de status reporting:
     - Incluir resultados de validação dos satellites no report ao usuário

#### 3. Validar mudanças no pipeline
- **ID**: validate-phase-3
- **Assigned To**: validator
- Verificar que init-phase.ts falha quando task repo não bate com satellite
- Verificar que init-phase.ts falha quando satellite worktree path não existe
- Verificar que build-phase.md tem loop de check-project para satellites
- Verificar que build-phase.md tem lógica explícita de scan por repo field
</tasks>

<execution>
**Wave 1** (parallel): validate-repo-field, update-build-phase-multirepo
**Wave 2** (validation): validate-phase-3
</execution>

<criteria>
- [ ] init-phase.ts exit 1 quando task repo não existe em satellites array
- [ ] init-phase.ts exit 1 quando satellite worktree path não existe no filesystem
- [ ] Mensagens de erro incluem task ID, repo name, e satellites disponíveis
- [ ] build-phase.md roda check-project para cada satellite que teve tasks na fase
- [ ] build-phase.md coleta satellite status via scan explícito de tasks por repo field
- [ ] build-phase.md agrega resultados de validação de satellites no report
</criteria>

<validation>
- `bun scripts/init-phase.ts 2>&1 | head -5` — mostra erro de argumento obrigatório
</validation>
</phase3>
