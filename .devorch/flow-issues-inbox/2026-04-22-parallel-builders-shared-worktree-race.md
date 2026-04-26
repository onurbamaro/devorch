# Parallel builders no mesmo worktree veem WIP intermediário um do outro

- **Timestamp**: 2026-04-22
- **Mode**: full (resume)
- **Severity**: gap

## Prompt sugerido

```
/devorch --full "address the parallel-builder race in F3c: when two or more devorch-builder agents run in parallel inside the same worktree (typical for tasks with `Repo: <same-satellite>`), each builder's typecheck/lint runs see the OTHER builder's uncommitted WIP. The `validate-plan.ts` file-overlap check today is path-overlap only, but typecheck/lint coupling is project-wide. Options: (a) serialize builders that share a worktree (lose parallelism within satellite); (b) require each builder to skip cross-file typecheck and trust per-file lint only; (c) give each builder its own ephemeral worktree off the satellite worktree. Document the tradeoff and pick one."
```

## Contexto

Phase 4 wave 1 dispatched 3 builders (`ranking-gate`, `admin-endpoints`, `session-response-v2`) em paralelo, todos com `Repo: dochron` → todos no mesmo `dochron` satellite worktree. O builder de `session-response-v2` reportou explicitamente no Build Report:

> "Three concurrent builder tasks ran in the SAME worktree instead of separate ones. I observed transient typecheck errors in `ranking.ts` then `track-admin.ts` between runs as the parallel agents saved WIP. The Explore note 'No file overlap. Sequence-safe to run parallel.' assumed isolated worktrees. If the orchestrator schedules sibling tasks in the same worktree, they MUST be serialized — otherwise typecheck/lint runs see racy intermediate states and the zero-tolerance policy becomes ambiguous (am I responsible for another agent's WIP errors?)."

Os 3 commits landaram OK no fim, mas durante a janela de execução cada builder viu erros que não eram seus. Isso compromete o "fix-once-on-failure" gate do F3c — um builder pode entrar em retry loop tentando consertar erro de outro builder.

**Esperado**: builders paralelos não veem WIP um do outro. Ou o devorch garante isso (worktrees ephemerais), ou serializa por satellite, ou afrouxa o critério de typecheck zero.

**Não houve impacto de saída** desta vez (todos os 3 commits válidos), mas o risco é real.

## Onde

`devorch-builder` agent definition + F3c orchestration in `commands/devorch.md` (orquestrador).
