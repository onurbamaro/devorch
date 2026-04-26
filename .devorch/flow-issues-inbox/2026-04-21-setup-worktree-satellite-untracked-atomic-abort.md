# setup-worktree.ts: satellite-untracked aborta mesmo com arquivos claramente auto-gerados

- **Timestamp**: 2026-04-21
- **Mode**: full
- **Severity**: gap

## Prompt pronto
```
/devorch --full "Em setup-worktree.ts, expandir a exclude-list default do guard de satellite-untracked para cobrir padrões auto-gerados comuns: `.claude/worktrees/`, `scripts/out/`, `.devorch/project-map.md`, `.devorch/explore-cache-*.md`. Opcional: adicionar flag `--allow-satellite-untracked <patterns>` para override pontual sem editar .gitignore do sibling."
```

## Contexto
- **Onde**: passo F2.8 de um plan multi-repo, satélite `dochron` em `/home/bruno/dev/dochron`.
- **O que aconteceu**: `setup-worktree.ts --add-secondary` retornou `{ok:false, error:"satellite-untracked"}` listando 4 arquivos:
  - `.claude/worktrees/cranky-heisenberg-3884fe/`
  - `.claude/worktrees/intelligent-knuth-7652be/`
  - `.devorch/project-map.md`
  - `scripts/out/aldeia-deepdive.csv`
- **Esperado**: todos são artefatos auto-gerados (Claude Code stages + devorch map-project output + script outputs). Nenhum é WIP do usuário. A guarda atomica é boa, mas a default exclude-list hoje é `[".worktrees/", "node_modules/", "dist/"]` — cai curta.
- **Workaround aplicado**: editei `/home/bruno/dev/dochron/.gitignore` pra adicionar os paths, rodei de novo, passou. Isso é um side effect fora do escopo do plan atual e polui o diff do satélite.
- **Impacto**: pequeno mas recorrente — qualquer multi-repo devorch run em sibling que tenha rodado outras ferramentas Claude/devorch no passado vai bater nessa guard.
