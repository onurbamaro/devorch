# Explore Cache
Generated: 2026-02-21T17:10:30Z

## setup-worktree.ts — Lifecycle & Error Handling

**Criacao**: `git worktree add <path> -b devorch/<name>` — atomico, se falha nao deixa residuos.

**Cenarios de falha identificados**:
1. **Worktree ja existe** (line 25-27): exit 1 imediato, sem cleanup.
2. **Branch ja existe**: `git worktree add -b` falha com `fatal: a branch named '...' already exists`. Script propaga o erro mas **nao tenta deletar a branch**.
3. **Falha parcial em satellites**: Se satellite N falha apos 1..N-1 criados, script exit(1) sem limpar os satellites criados nem a worktree principal.

**O que NAO existe**:
- Nenhum flag `--recreate` ou `--force`
- Nenhum flag `--add-secondary` para worktree existente
- Nenhum cleanup automatico de branches orfas
- Nenhum rollback de satellites parciais

**Satellites**: Criados sequencialmente (nao em paralelo). Cada um recebe a mesma branch `devorch/<name>`. Validacao: isGitRepo + checkBranchExists + warn uncommitted.

## map-project.ts — Capacidades e Limitacoes

**O que faz**: Scan recursivo (2 niveis), detecta 16 tech stacks por marker files, extrai deps/scripts de package.json, git log recente. Output: Markdown. `--persist` salva em `.devorch/project-map.md`.

**O que NAO faz**:
- Deteccao de repos irmaos/nested `.git`
- Deteccao de monorepo com git roots separados
- Deteccao de workspaces (pnpm/yarn/npm)
- Deteccao de submodules ou worktrees existentes
- `.git` esta no IGNORE list — completamente invisivel

**Impacto**: Quando o projeto esta em `packages/web` e `packages/core` tem seu proprio `.git`, o map-project.ts nao reporta isso. O orchestrator descobre tarde demais (durante exploracao), depois da worktree ja ter sido criada sem `--secondary`.

## Fluxo orchestrator → worktree — Gaps no Multi-Repo

**Fluxo atual**: talk.md Step 3 menciona perguntar sobre secondary repos, mas **nao especifica quem/como descobre os repos irmaos**. A informacao de secondary repos vem da resposta do usuario, nao de deteccao automatica.

**Problema raiz**: A criacao da worktree (Step 7) acontece DEPOIS da exploracao (Step 2), mas a exploracao e que descobre a necessidade de secondary repos. Se a worktree ja foi criada sem `--secondary`, nao ha como adicionar satellites depois.

**Path resolution inconsistencia**: setup-worktree usa `resolve(cwd, repo.path)`, init-phase usa `resolve(projectRoot, repo.path)`, list-worktrees usa `resolve(mainRepoRoot, repo.path)`. Funcionam igual na maioria dos casos mas podem divergir.

## Pipeline Flow & Round-trip Bottlenecks (cache anterior)

- Talk phase: ~8 think cycles
- Build phase (per phase): ~6 think cycles
- Total 3-phase build: ~25-35 think cycles, ~30-40% overhead
- Script proliferation: 12+ sequential script calls
- Redundant plan parsing: 5x, secondary-repos parsed 3x
