# FLAGS

Spec for `.devorch/flags-<plan>.md` (per-plan adjacent findings) and
`.devorch/standards-silenced.md` (per-project muted patterns).

## Purpose

Flags capture items the guardian detected adjacent to the current task
but outside its scope — SQL concatenation in a file you only touched to
rename a variable, a missing index on a query path you read but did not
modify, a proxy pattern in an upload handler next door. They are not
blockers; they are a queue of follow-ups. Silenced is the opposite queue:
patterns the user has repeatedly acknowledged and chosen to leave alone,
so the guardian stops re-reporting them on every run.

## `flags-<plan>.md` format

One file per plan, written during the `full`-mode adversarial review and
appended to during `scoped`/`quick` runs when the guardian detects an
adjacent item. Lives at `.devorch/flags-<plan>.md` where `<plan>` matches
the plan's kebab-case name.

```markdown
# Flags: <plan-name>

## <path:line> — <short title>
**Tipo**: security | performance | architecture | ops
**Severidade**: low | medium | high
**Detecção**: <one-line evidence, usually a code snippet or pattern>
**Risco** ou **Custo estimado**: <concrete consequence>
**Correção sugerida**: <one-line fix direction>
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar
```

Field semantics:

- **Tipo** — one of the four guardian domains. Drives where the item
  routes if the user picks `new-plan`.
- **Severidade** — `high` means "fix before next deploy", `medium` means
  "schedule this cycle", `low` means "track, no urgency".
- **Detecção** — literal evidence. Code snippet preferred, pattern name
  acceptable. Must be specific enough to locate the issue.
- **Risco** (security/ops) or **Custo estimado** (performance) — the
  concrete consequence. Order-of-magnitude estimates are fine; vague
  warnings are not.
- **Correção sugerida** — one line, direction not prescription.
- **Ação** — three checkboxes, exactly one checked by the user:
  - `fix-now` — include in current plan's follow-up commit
  - `new-plan` — spawn a new plan via `/d "fix flag: <title>"`
  - `ciente-deixar` — acknowledge and leave; counts toward silence

## Lifecycle

1. **Creation** — `full` mode always emits a `flags-<plan>.md` during the
   final adversarial review, even if empty (file contains only the
   header). `scoped` and `quick` modes create the file lazily, the first
   time the guardian detects an adjacent item.
2. **Append-only during execution** — if a later phase or a later `/d`
   invocation against the same plan detects new items, entries are
   appended. Existing entries with user-checked actions are not rewritten.
3. **User edits actions** — the user opens the file and checks one box
   per entry. No orchestrator intervention required.
4. **Next `/d` run reads actions** — on startup, the orchestrator scans
   `.devorch/flags-*.md` for checked boxes:
   - `fix-now` → queues the fix into the current request's task list
   - `new-plan` → shells out to `/d "fix flag: <title>"` after confirmation
   - `ciente-deixar` → increments silence counter for the pattern
5. **Archival** — when the plan is merged via `/devorch:worktrees merge`,
   its flags file is moved to `.devorch/archive/flags-<plan>-<date>.md`
   along with the plan itself.

## `standards-silenced.md` format

One file per project at `.devorch/standards-silenced.md`. Auto-maintained;
user edits are respected but not required.

```markdown
# Silenced flags

## <identifier>
Silenced at <YYYY-MM-DD>. Reason: <one line, inferred or user-provided>.
Reactivate: delete this block.
```

`<identifier>` is a `file-glob:line-or-pattern:rule` triplet — specific
enough to match the recurring detection, broad enough to cover the whole
folder the user dismissed across:

- `api/legacy/*:*:sql-concat` — any SQL concat in legacy folder
- `workers/bulk-import.ts:142:n-plus-one` — exact line, exact rule
- `*:*:missing-observability` — entire project, specific rule

## Automatic silencing

Trigger: the same user marks `ciente-deixar` three times on entries that
share the same `<tipo>` and `<pattern>` (derived from Detecção). On the
third dismissal the orchestrator:

1. Appends an entry to `standards-silenced.md` with date and an inferred
   reason ("dismissed 3 times across <plan-a>, <plan-b>, <plan-c>").
2. Prints a notice to the user in pt-BR:

```
Flag "<pattern>" silenciado automaticamente após 3 dismissos.
Pattern: <identifier>
Reativar: edite .devorch/standards-silenced.md e remova o bloco.
```

Before emitting any heads-up, the guardian consults
`standards-silenced.md`. Matches pass through silently. This keeps the
warning channel signal-heavy — the user sees each pattern at most three
times unless they actively fix or reactivate.

## Audit

Two entry points:

- `/d --flags` — lists pending flags across all plans in the project,
  grouped by severity. Read-only; does not modify files.
- Direct file read — `.devorch/flags-*.md` is plain markdown, greppable.
  CI can parse it for dashboard metrics if desired.

Silenced entries are not surfaced in the audit by default (they are, by
definition, things the user told devorch to stop mentioning). To review
them, open `standards-silenced.md` directly.

## Examples

### `.devorch/flags-upload-flow.md`

```markdown
# Flags: upload-flow

## api/orders.ts:88 — SQL concatenation
**Tipo**: security
**Severidade**: high
**Detecção**: db.query("SELECT * FROM orders WHERE id = " + req.params.id)
**Risco**: SQL injection (OWASP A03)
**Correção sugerida**: parameterized query via prepared statement
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## api/upload.ts — proxy pattern
**Tipo**: performance
**Severidade**: medium
**Detecção**: worker processa multipart upload no endpoint, reencaminha para storage
**Custo estimado**: ~30MB RAM por sessão × N workers concorrentes
**Correção sugerida**: signed URL direto para storage + webhook de conclusão
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar

## api/list-jobs.ts:34 — missing pagination
**Tipo**: architecture
**Severidade**: low
**Detecção**: SELECT * FROM jobs sem LIMIT, retornado inteiro no response
**Risco**: unbounded response à medida que tabela cresce
**Correção sugerida**: cursor-based pagination, limit default 50
**Ação**: [ ] fix-now  [ ] new-plan  [ ] ciente-deixar
```

### `.devorch/standards-silenced.md`

```markdown
# Silenced flags

## api/legacy/*:*:sql-concat
Silenced at 2026-04-16. Reason: legacy code, migração agendada em plan separado.
Reactivate: delete this block.

## workers/*.ts:*:missing-observability
Silenced at 2026-03-02. Reason: dismissed 3 times across plan-refactor-queue,
plan-add-retry, plan-bulk-import — Bruno aceita ausência de tracing neste tier.
Reactivate: delete this block.
```
