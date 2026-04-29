# merge-worktree.ts archival commit falha silenciosamente em `.devorch/` gitignored

**Timestamp:** 2026-04-27T(close-e2e-final-gap)
**Severity:** gap

## Prompt pronto

```
/devorch "fix merge-worktree.ts to use `git add -f` (or set archival commit to allow gitignored paths) when the active plan path is under .devorch/ and the project gitignores .devorch/. Currently archives the file on disk via mv but the follow-up commit fails with 'paths are ignored', leaving an uncommitted index state that requires orchestrator manual cleanup."
```

## Contexto

Durante `close-e2e-final-gap`, ao final do `merge-worktree.ts --worktree close-e2e-final-gap`:

```
Archival stage failed: The following paths are ignored by one of your .gitignore files:
.devorch
hint: Use -f if you really want to add them.
```

O script reportou `archivalCommit: null` no JSON de saída, mas mesmo assim seguiu adiante removendo a worktree e a branch. O resultado: filesystem ficou correto (`.devorch/plans/close-e2e-final-gap.md` movido para `archive/2026-04-27-close-e2e-final-gap.md`), porém o estado de git ficou bagunçado: o delete do plano ativo foi parar staged no index do `main`, e o archive não foi commitado. Orchestrator precisou rodar manualmente `git add -f .devorch/plans/archive/<file>.md` + `git commit` para finalizar.

Repos afetados: qualquer projeto que liste `.devorch/` no `.gitignore` mas use devorch (que precisa commitar plan files no flow normal). Padrão atual: orchestrator usa `git add -f` no Step 8.2 (commit do plano inicial) — mesma flag deveria estar no archival.

**Workaround atual:** orchestrator inspeciona o JSON de saída, vê `archivalCommit: null`, e roda commit manual com `-f`. Funciona mas adiciona 2 minutos por merge em projetos com `.devorch` ignored.

**Fix:** em `merge-worktree.ts`, no archival step, usar `git add -f` para incluir paths gitignored. Alternativa: detectar gitignore match antecipadamente e logar o caminho de fallback explicitamente em vez de "Archival stage failed".
