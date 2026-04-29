# init-phase.ts injeta gotchas irrelevantes ao escopo da task

**Timestamp:** 2026-04-27T(close-e2e-final-gap)
**Severity:** nit

## Prompt pronto

```
/devorch "improve init-phase.ts gotcha selection to score relevance against the task's <files> list. Currently picks the first 5 entries from GOTCHAS.md regardless of whether they touch the same area — E2E test bundle tasks routinely receive gotchas about Drizzle migrations, BullMQ jobIds, and IEEE754 sector boundaries even though none of the changed files touch those subsystems. Suggested heuristic: prefer gotchas whose `(file:line)` cite is under a path prefix shared with at least one entry in <files>."
```

## Contexto

Em `close-e2e-final-gap`, todas as 7 tasks Phase 1 receberam o mesmo set de 5 gotchas no `## Phase Context`:
- BullMQ jobId não aceita `:`
- Migration hand-authored journal entry
- generateIdealLapTelemetry IEEE754
- bun test sem --exclude
- CapRover BuildKit

Nenhum desses tem qualquer relação com specs E2E Playwright + 1 endpoint test-only + 1 config env. Os gotchas REALMENTE relevantes (`AuthGate redirect known routes`, `known-routes lazy init TDZ`, `/efi-webhook EXISTS not SETNX`, `mock.module env getters frozen`) tive que injetar manualmente via Explore Findings em cada prompt builder.

Custo estimado: ~200 tokens de slice por task gastos em gotchas irrelevantes que o builder vai ignorar. Não bloqueante — builders são suficientemente inteligentes para ignorar — mas dilui o sinal e o "Phase Context" perde valor.

**Sugestão de heurística:** filtrar gotchas onde `(file:line)` cite começa com algum path prefix ≥2 segmentos compartilhado com qualquer entry em `<files>`. Por exemplo, task com `<files>` em `tests/e2e/billing/*` puxaria gotchas sob `src/server/routes/billing*` ou `src/server/lib/billing*`, não sob `src/server/lib/queues/`. Backup: se < 3 gotchas survive filter, completar com top-N globais (estado atual).

**Workaround atual:** orchestrator injeta gotchas relevantes via Explore Findings, ignorando os do Phase Context. Funciona mas duplica trabalho.
