---
description: "Plan-driven build with DAG-parallel phases + adversarial review"
argument-hint: "[--resume] <what to do>"
model: opus
effort: xhigh
disallowed-tools: EnterPlanMode
---

Single-mode entry point for devorch. Use it whenever you need orchestration of medium-to-large work — for trivial edits (single-file typo, rename in a known location), use vanilla Claude Code; devorch's ceremony does not pay off there.

Pipeline has 5 stages: discovery → plan → build (DAG scheduler) → quality gates → save flags. Worktrees are NOT a devorch internal — if you want two parallel sessions on the same repo, create them yourself with `git worktree add` and run a separate Claude Code in each. Devorch always commits directly to the current branch.

**Input**: `$ARGUMENTS` — description plus optional flag:
- `--resume` — resume an in-progress plan on the current branch (no description needed)

After stripping `--resume`, if the remaining `$ARGUMENTS` is empty and `--resume` is not set, stop and ask the user.

## Stage 0 — Resume short-circuit

If `--resume` is present:
1. List `.md` files under `.devorch/plans/` (excluding `archive/`) where the file does not have all phases marked `status="done"`.
2. If `count == 0` → report "Nenhum plano em progresso para retomar." and stop.
3. If `count == 1` → resume that plan directly. If `count > 1` → `AskUserQuestion` listing each plan title and pick one.
4. Set `planPath = .devorch/plans/<chosen>.md`. Skip Stages 1 and 2 entirely; jump to Stage 3 (build scheduler) which reads the plan and resumes from the first non-done phase.

Note: on resume, the original explore findings are gone. The scheduler proceeds with whatever the plan and gotchas already encode. If a remaining phase needs broader context, the scheduler may launch a fresh Explore agent inline before dispatching that phase.

## Stage 1 — Discovery (parallel)

All of the following run in parallel — single assistant message with multiple tool calls. Both Bash calls are robust (always exit 0 on missing optional inputs) so a failure in one does NOT cancel the parallel Explore agents:

1. **Project map** — run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts --persist`. The script writes `.devorch/cache/project-map.md` and prints structural snapshot (3-level tree, scripts, Makefile, sibling repos).
2. **Context loader** — run `bun $CLAUDE_HOME/devorch-scripts/load-context.ts`. Always exits 0. Returns JSON `{gotchas, gotchasLegacy, profile: {raw, source}, silencedStandards, warnings}`. The script handles missing files (empty strings), legacy `CONVENTIONS.md` fallback, and profile precedence (per-project → user-home → defaults from `docs/PROFILE.md`). Keep `profile.raw` as `<profile>` for the guardian role; consult `silencedStandards` before emitting heads-ups.
3. **Explore agents** — launch 1–3 Explore agents (`subagent_type="Explore"`) with focuses derived from `$ARGUMENTS`:
   - Always: 1 agent on architecture + existing patterns in the touched area.
   - When the request spans 2+ modules or has multi-feature scope: 1 additional agent on risks/edge surfaces.
   - When the request references a specific contract / spec / behavior: 1 additional agent dedicated to locating and reading it deeply.
   Hard cap: 3 explore agents per session. If you reach the cap and still feel under-informed, the request is malformed — surface that to the user.

Wait for all parallel work to return before proceeding. Read `project-map.md` after the script completes.

### Stage 1.5 — Guardian role + edge-case enumeration (inline)

Apply this role internally over `$ARGUMENTS` + project-map + GOTCHAS + explore findings + `<profile>`:

> You are a senior engineer pair reviewing work from a well-intentioned self-taught dev who is performance-first and values architectural elegance.
>
> 1. Evaluate the request and adjacent code against industry standards in:
>    - Security (OWASP Top 10)
>    - Performance (latency, cost, scalability, cache tiers)
>    - Architecture (separation, coupling, observability)
>    - Operations (failure, retry, idempotency)
>
> 2. Bucketize findings into:
>    - **critical heads-up** — known right answer → redirect
>    - **real bifurcation** — legitimate trade-off → present
>    - **silence** — correct → do not comment
>
> 3. Concrete recommendations: cite estimated cost (order of magnitude), anti-pattern name, alternative in 1 line.
>
> 4. Do NOT teach. Redirect. Senior pair tone: "by here, not by there". Explain only if the user asks.
>
> Domain checklist (mnemonic): auth · rate-limiting · input validation · error boundaries · caching · indexing · N+1 · pagination · realtime strategy · upload path · async/queue · observability · idempotency · secrets handling · cross-tenant isolation.
>
> If `<profile>` is set: `priorities` ordering breaks bifurcation ties; `biases` are additional hints. On performance-vs-simplicity trade-offs, show cost and let the user choose.
>
> Also consult `.devorch/standards-silenced.md` if present — skip heads-ups matching silenced patterns.

Then enumerate edge cases into 3 buckets:

- **Resolved by code/gotcha/request** — count only
- **Critical heads-up** (guardian) — show with redirect
- **Real bifurcation** — show with A/B/... options and a recommendation

**Skip-when-silent**: if `K + J == 0` (no real bifurcations, no critical heads-ups), skip the gate entirely and go straight to Stage 2. Zero questions is a valid outcome.

Otherwise emit only the counts block (plain markdown — no box-drawing):

```
Edge cases considerados: N
Resolvidos por convenção/código/pedido: M
Bifurcações reais: K
Heads up crítico: J
```

Then run the unified gate (§ Unified gate UX below). After gate resolves, capture every user choice for the `<decisions>` block of the plan.

## Stage 2 — Plan (write + self-check)

Draft the plan per `docs/PLAN-FORMAT.md`. Write it to `.devorch/plans/<name>.md` where `<name>` is kebab-case (3–5 words derived from `$ARGUMENTS`). Every task uses an `**ID**` and a `**Files**` list.

**DAG mindset**: model phases as a graph with explicit `<depends-on>`. Two phases that don't share files and don't have a dep chain between them are intended to run in parallel. Examples that should NOT be serialized:
- A new model + telemetry instrumentation in pre-existing code
- Backend code change + standalone docs update
- Two independent features mentioned in the same `$ARGUMENTS`

**Bundle trivial mechanical fixes** — when 2+ tasks share the same phase, have small specs (under ~500 tokens combined), target disjoint files, and are mechanical (flag adds, regex tweaks, hint strings, doc rewrites), bundle them into a single task with bullet-points. Reserve separate tasks for genuinely independent units of judgment.

Then **self-check** the plan inline (no script):

1. **Structural** — Required blocks present (`<description>`, `<objective>`, `<classification>`, `<decisions>`). Every phase has unique `id`, `<goal>`, `<tasks>`, `<criteria>`. Every task has `**ID**` and `**Files**`.
2. **DAG correctness** — `<depends-on>` references only existing phase IDs; no cycles (topologically sortable).
3. **File disjunction within a phase** — no two tasks in the same phase share a file.
4. **File disjunction across parallel phases** — for every pair of phases (A, B) where neither depends on the other (directly or transitively), their declared file sets are disjoint.
5. **Implicit-touch sweep** — read each task description and infer files the task will touch even though they're not listed (barrel `index.ts`, hook registries, route registries, generated migration filenames). Grep the repo to confirm. If a candidate is verified, add it to the task's `**Files**` line. Re-run check 3 and 4 with the augmented file lists. If overlap appears, redraft the plan (move a task to a later phase, or merge phases, or split files differently). Common shapes:
   - Barrel files / index aggregators (`src/index.ts`, `mod.ts`) when adding/renaming exports
   - Hook registries when adding a new hook
   - Plugin / command / route registries when adding new entries
   - Type re-exports (`types.ts`, `index.d.ts`) when adding a new exported type

If any check fails and cannot be auto-fixed, redraft the plan and re-check before continuing. Once all checks pass, commit the plan: `git add .devorch/plans/<name>.md` (and `.devorch/GOTCHAS.md` if updated) → `git commit -m "chore(devorch): plan — <name>"`.

**Active plan commit is best-effort**: if `git add` fails because `.devorch/plans/` is gitignored (some projects keep active plans untracked and only commit `archive/` via convention), skip the commit silently — do NOT use `-f`. The active plan is a transient artifact; the durable record is the Stage 5 archive (which uses `git add -f` defensively, since archived plans are convention-tracked even when `.devorch/` is otherwise ignored). The working tree retains the active plan regardless, so builders can still read it. If `.devorch/GOTCHAS.md` was updated and is tracked, commit it standalone with `git commit -m "chore(devorch): gotchas update"`.

Set `planPath = .devorch/plans/<name>.md`.

## Stage 3 — Build (DAG scheduler)

Loop until every phase in the plan is marked `status="done"`:

1. **Compute ready set**: phases whose `<depends-on>` are all `done` AND whose declared files don't overlap with any currently-running phase. (On the first iteration of a fresh build, no phases are running, so the ready set is every phase with empty `<depends-on>`.)
2. If ready set is empty AND no phases are currently running → all done, exit loop.
3. **Dispatch every ready phase in parallel** in a single assistant message:
   - For each ready phase, launch all its tasks via the Task tool with `subagent_type="devorch-builder"`. One Task tool call per task. All Task calls go in the same assistant message so they run in parallel.
4. **Wait for the wave to complete.** When all dispatched tasks return:
   - For each task, verify completion via `git log --oneline` (a commit matching the task ID/title appears).
   - For each phase whose tasks all committed successfully, mark it `status="done"` in the plan file (in-place edit: `<phase id="X" name="Y">` → `<phase id="X" name="Y" status="done">`).
5. Recompute and loop.

### Builder prompt assembly (per task)

For each task, build the prompt as follows:

1. **Working directory** — `Working directory: <cwd>` (the current repo root). All git operations run on the current branch.
2. **Plan context** — Plan title + `<objective>` + `<solution-approach>` (if present) + `<decisions>`.
3. **Full task details** — read `<planPath>` and extract the section for this task (from `#### N. <Title>` until the next `#### ` or `</tasks>` boundary). Include task ID, Files, Spec refs, Exemplars, Non-goals, body bullets.
4. **Spec contracts** — resolve Spec refs against the phase's `<spec>` block; inline the referenced `<entity>`/`<behavior>`/`<invariant>`/`<endpoint>`/`<error-contract>` elements.
5. **Relevant gotchas** — filter `.devorch/GOTCHAS.md` to entries whose `file:line` reference touches files in the task's `**Files**` list, OR whose title relates semantically to the task. Inline matching entries; omit the section entirely if none match.
6. **Explore findings** — orchestrator-curated subset of Stage 1 explore output relevant to this task (files mentioned, patterns touched). Omit the section entirely if no findings are relevant.
7. **Exemplars** — if the task lists Exemplars, suggest the builder Read those files for stylistic mirroring.

Send all task prompts in a single assistant message (one Task call per task). Builder retries on failure: up to 3 attempts per task. Each retry appends a `## Previous Failure Context` section: retry count, last 50 lines of prior output, `git diff` from the failed attempt (or "no commits"), instruction to diagnose root cause. On retry exhaustion: stop the build, emit a structured failure report, suggest a fresh `/devorch` invocation for re-planning.

**On agent resolution failure** (Task tool returns `Agent type not found`): the builder agent isn't registered in the current session — typically because it was installed after session start. Surface the registration issue and suggest restarting Claude Code after `bun install.ts`.

### Inline Explore on resume

On the resume path, the original Stage 1 findings are gone. If a phase about to dispatch needs broader context (the orchestrator judges based on the gap between gotchas and what the task implies), launch a single Explore agent inline before assembling that phase's builder prompts. Use the same scoping rules as Stage 1 but with the phase's specific scope — not the whole request.

## Stage 4 — Quality gates (parallel)

After the DAG completes, run all of the following in parallel in a single assistant message:

1. **`check-project`** — `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <cwd>` (full: lint + typecheck + build + tests). Parse JSON.
2. **Adversarial reviewers** — 4 Explore agents (`subagent_type="Explore"`, foreground), each receiving: `Working directory: <cwd>`, plan objective, GOTCHAS.md (if present), changed-files list (`git diff --name-only <baseBranch>...HEAD`).
   - **security** — OWASP Top 10 anti-patterns, injection risks, auth gaps, data exposure, secrets handling
   - **performance** — estimated cost, anti-patterns (N+1, full scans, polling, synchronous workers, server-side buffering), cache opportunities
   - **completeness** — spec vs delivery: every `<spec>` element satisfied? cross-phase integration intact? handoffs honored? Required method: for each `<behavior>`/`<invariant>`/`<endpoint>` in the plan, grep the changed files for its identifying symbol AND verify with a direct Read on the relevant line range. Do not infer from absence at a stale line number.
   - **flags** — adjacent items out of scope. For each flag: type (security | performance | architecture | ops), severity, detection (`file:line`), suggested fix, one-line alternative. Reviewer writes all flags to `.devorch/flags-<name>.md` using the `docs/FLAGS.md` format.
3. **Residual scan** — grep for `TODO|FIXME|HACK|XXX` across changed files. Inline; cheap.

**Anti-staleness directive (in every reviewer prompt)**: read file contents at current HEAD, not the base branch. Cite `file:line` from the current state. Before reporting a contract as unsatisfied, grep for the expected new symbol or phrase in the actual file. A reviewer reporting "not implemented" without such a grep check is treated as stale and re-run.

`<baseBranch>` resolution: `git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null` and strip `origin/`; fall back to `main` then `master`.

## Stage 4.5 — Apply review fixes

Before classifying and dispatching, compute file overlap between findings. Two findings touching the same file CANNOT be dispatched in parallel — sequence them. Findings on disjoint files run in parallel.

Classify each finding:
- **Trivial** (1–2 files, obvious fix) → apply inline with Edit.
- **Fix-level** (well-defined, 3+ files or non-trivial) → launch `devorch-builder` agents in parallel (respecting non-overlap).
- **Talk-level** (needs design) → do not fix; leave as a pending item plus a suggested fresh `/devorch` prompt.

Skip this stage entirely if every reviewer + residual scan reported zero findings. After fixes, re-run `check-project` (full if any fix-level launched, `--quick` if trivial only). One retry on failure.

## Stage 5 — Verdict + save flags

### Verdict report

```
## Verificação Final: <name>

### Residual Scan
<findings ou "limpo">

### Review Adversarial
Security: <findings ou "limpo">
Performance: <findings ou "limpo">
Completeness: <findings ou "limpo">
Flags: <count — ver .devorch/flags-<name>.md ou "nenhuma">

### Correções de Review
<N trivial, M fix-level> (ou "Nenhuma")

### Post-Review Check
Lint / Typecheck / Build / Tests: status

### Issues Pendentes
<talk-level items com prompt /devorch sugerido ou "Nenhum">

### Verdict: PASS / PASS com N pendências / FAIL
```

### Archive plan

If verdict is PASS (or PASS with non-blocking pendencies):
- `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan <planPath>` — moves plan to `.devorch/plans/archive/<name>.md` AND stages it for commit (`git add -f` on the archive path, `git add -u` on the active path to capture deletion if it was tracked). The script's JSON output includes `staged: true|false`; if `staged` is false, `git` is unavailable and the orchestrator should fall back to manual staging.
- Also archive the flags file alongside if present: `git mv -f .devorch/flags-<name>.md .devorch/archive/flags-<name>-<YYYY-MM-DD>.md` (or copy + delete + `git add -f` if `git mv` rejects gitignored sources).
- Commit: `chore(devorch): archive plan — <name>`.

On FAIL → keep the plan active so `--resume` can pick up where the failure left off. Suggest the user inspect, then `/devorch --resume` after fixing manually, or a fresh `/devorch "<fix description>"`.

### Gotcha capture

Apply the gotcha-capture rule (§ Gotcha capture below).

### Flow friction capture

Roda antes do report final. Captura atritos no próprio fluxo do devorch — não em código do usuário. Conta: script errou ou retornou JSON malformado, retry loop precisou >1 tentativa, gate precisou ser reinvocado, hook não disparou quando devia, você improvisou porque a instrução estava ambígua, bifurcação sem precedente nem resposta da indústria.

**Inbox path** (primeiro que casar): `$DEVORCH_REPO/.devorch/flow-issues-inbox/` → `../devorch/.devorch/flow-issues-inbox/` → `<cwd>/.devorch/flow-issues-inbox/`.

**Um arquivo por atrito**, nomeado `<YYYY-MM-DD>-<slug>.md`, contendo: título, timestamp, `Severity` (blocker/gap/nit), prompt pronto (`/devorch "<fix>"`), contexto mínimo (onde/o que aconteceu/esperado/workaround).

**Zero atritos**: não escreva nada e omita qualquer menção no report. **≥1 atrito**: adicione ao report `### Flow friction capture: N item(s) em <inbox-path>/`.

---

## Unified gate UX (used by Stage 1.5)

**Precondition**: este gate só roda quando há pelo menos uma bifurcação real ou um heads-up crítico (`K + J > 0`). Se ambos forem zero, Stage 1.5 já terá pulado este gate silenciosamente. Se só heads-ups existirem (`J > 0`, `K == 0`), rode apenas o heads-up pass; se só bifurcações existirem (`K > 0`, `J == 0`), rode apenas o bifurcations pass.

### Heads-up pass (quando `J > 0`)

Antes da pergunta, emita a lista dos heads-ups como markdown simples:

```
Heads-ups críticos:
1. <título curto> — `file:line` (se conhecido) — <motivo/redirect em 1 linha>
2. ...
```

Então faça **uma única** `AskUserQuestion` agregando todos os heads-ups:

- `question`: "Quer comentar algo sobre os heads-ups acima, ou sigo com as correções recomendadas?"
- `header`: "Heads-ups"
- `multiSelect`: false
- `options` (2 opções; o botão **Other** — gerado automaticamente — é o canal para escrever comentário ou override livre):
  - label `"Seguir recomendações"`, description: "Aplicar todas as correções recomendadas pelos heads-ups acima sem input adicional."
  - label `"Pular heads-up(s)"`, description: "Preservar o código atual ignorando uma ou mais recomendações. Use 'Other' para indicar quais números pular e por quê."

Se o usuário escolher "Other" e escrever texto livre, trate o conteúdo como override ou comentário — ajuste o plano de acordo antes de prosseguir.

### Bifurcations pass (quando `K > 0`)

Cada bifurcação vira uma pergunta dedicada em `AskUserQuestion` (até 4 perguntas por chamada; se `K > 4`, pagine em rounds sucessivos).

Cada pergunta segue estas regras de clareza:

- `question`: 2–4 frases. Comece contextualizando **onde** a decisão incide (arquivo, módulo, feature, endpoint), **o que** está em jogo (qual comportamento/propriedade muda conforme a escolha), e **por que** precisa decidir agora. Termine com a pergunta objetiva. A pergunta deve ser inteligível lida isoladamente.
- `header`: 1–2 palavras que nomeiam o eixo da decisão (ex.: "Sessão", "Cache", "Paginação").
- `multiSelect`: false, salvo quando a bifurcação for legitimamente multi-select.
- `options`: 2–4 opções A/B/... Cada opção com:
  - `label` — 1–5 palavras nomeando a abordagem. Marque a recomendada como **primeira opção** com sufixo ` (recomendada)` no label.
  - `description` — 2–3 frases cobrindo: (1) o que a opção faz concretamente; (2) o trade-off principal; (3) quando ela é preferível. Na opção recomendada, inclua o motivo da recomendação (priorities do profile, convenção do repo, anti-pattern evitado).

Zero questions é resultado válido — se `K == 0` e `J == 0`, Stage 1.5 já pulou este gate.

## Gotcha capture

Gotchas are invariants the code does not self-document — non-obvious behaviors a fresh reader would discover only by hitting a bug. GOTCHAS.md grows organically: the orchestrator curates candidates during the run and, silently, writes those that clear the quality bar. No script bulk-generates entries; no `AskUserQuestion` gates the write.

**When to accumulate candidates** (any of the following during the run):

- A builder needed a retry caused by undocumented behavior.
- A reviewer (security / performance / completeness / flags) explicitly marked a finding as "this surprised me" or "non-obvious".
- The guardian flagged an invariant not enforced by types/tests/linter.
- A type or interface did not describe real runtime state.
- Understanding a touched area required reading non-adjacent files for a non-obvious reason.

**Quality bar** — every accepted candidate must satisfy all four. If any fails, drop silently.

1. **Concrete `file:line` reference** — a future reader can jump straight there. No "somewhere in module X".
2. **"Why it surprises" sentence** — one sentence a fresh Claude session would genuinely benefit from. If it reads generic, the candidate fails — that is self-documenting code or a platitude.
3. **Not covered by types, tests, linter, or obvious code reading** — if TypeScript, a test name, or a lint rule already encodes the invariant, it is not a gotcha.
4. **Would change a future session's behavior** — landing here, a future Claude would take a different action. Historical trivia and commit-log summaries fail this test.

When in doubt, drop it. A smaller GOTCHAS.md that is fully load-bearing beats a larger one diluted by marginal entries.

**Dedupe before writing**: read the existing `GOTCHAS.md` (if any) and discard candidates whose title or `file:line` already appears. Never rewrite existing entries.

**Writing**: append surviving candidates to `.devorch/GOTCHAS.md` (create with `# Gotchas\n` header if missing). Shape per entry:

```
- **<short title>** (`file:line`) — <one-line why it surprises>.
```

Commit once per session (not per candidate):
- 1 entry → `chore(devorch): gotcha — <short title>`
- 2+ entries → `chore(devorch): gotchas — <N> entries`

**Report transparency**: when ≥1 entry was written, add a section to the final report:

```
### Gotchas adicionados: N em .devorch/GOTCHAS.md
- <short title> (`file:line`)
- ...
```

When zero entries were written, omit the section entirely.

**Prune on demand, not automatically**: `/devorch "review gotchas"` re-reads each entry against current code and proposes removals.

---

## Rules

- **Explore claim re-verification**: when an Explore agent reports a deterministic claim — counts, absences, or presences as fact ("zero importers", "no usages found", "deprecated", "0 references", "only referenced by X") — the orchestrator MUST verify with a deterministic grep before quoting the claim to a builder, surfacing it in `<decisions>`, or using it to justify a Stage 1.5 silence. Run the grep yourself (`git grep -n <symbol>`, `grep -rn`, etc.) and compare. If the grep contradicts the Explore claim, prefer the grep result and surface the discrepancy as a one-line note in the affected slice. Do not propagate uncertain claims as certainties — Explore is a hypothesis generator, grep is the oracle.
- Do not narrate actions. Execute directly without preamble.
- The orchestrator reads `.devorch/*` files and Explore/review agent output; it does not read source files directly except for applying trivial fixes in Stage 4.5 and the implicit-touch sweep in Stage 2.
- Silence is valid in the guardian role — do not fabricate heads-ups.
- Post-edit lint hook is always active (registered on the builder agent).
- **Language policy**: User-facing output (questions, reports, summaries) in Portuguese pt-BR with correct accentuation. Code, git commits, internal files, and technical comments in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese sentences.
- **Output format**: Plain markdown only. No box-drawing, no ASCII art, no decorative characters.
- **Branch policy**: devorch commits directly to the current branch. If you want isolation, create a `git worktree add`'d directory yourself and run a separate Claude Code session there — that is the only supported parallelism model for two simultaneous sessions on the same repo.
