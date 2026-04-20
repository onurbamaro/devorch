---
description: "Unified entry — triage, guardian, build (quick/scoped/full)"
argument-hint: "[--quick|--full|--resume|--worktree] <what to do>"
model: opus
effort: xhigh
disallowed-tools: EnterPlanMode
---

Unified entry point for devorch v3. Replaces talk+build+fix conceptually: classifies the request, applies a senior-guardian pass, then executes at the ceremony level the scope actually deserves.

**Input**: `$ARGUMENTS` — description plus optional flags:
- `--quick` — force quick mode (override triage)
- `--full` — force full mode (override triage, always creates worktree)
- `--worktree` — force worktree for scoped mode (opt-in)
- `--resume` — resume an active worktree (no description needed)

After stripping known flags (`--quick`, `--full`, `--resume`, `--worktree`), if the remaining `$ARGUMENTS` is empty and `--resume` is not set, stop and ask the user.

## Step 0 — Resume short-circuit

If `--resume` is present:
1. Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON.
2. If `count == 0` → report "Nenhum worktree ativo para retomar." and stop.
3. If `count == 1` → resume that worktree directly. If `count > 1` → `AskUserQuestion` presenting each worktree (name + plan title) and pick one.
4. Once a worktree is chosen, establish the full resume context before jumping to F3:
   - `mainRoot = <cwd>` (the main repo root where `.worktrees/` lives)
   - `projectRoot = .worktrees/<name>`
   - `<name> = basename(projectRoot)`
   - `planPath` = the first `.md` under `<projectRoot>/.devorch/plans/` (excluding `archive/`)
   - `originalBranch` = run `git -C <mainRoot> symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo main` and strip `origin/` prefix; fall back to `main` or `master` as available.
5. Jump to full-mode Step F3 (phase loop) with these bindings. Note: on resume, the in-memory explore findings from the original F2 are gone — builders will still receive gotchas + specs + code structure, and you may launch a fresh Explore agent from F3 if a task needs broader context.

## Step 1 — Load minimal context

Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` to collect folder structure, scripts, and sibling repos inline. Read `.devorch/GOTCHAS.md` if it exists (fall back to `.devorch/CONVENTIONS.md` for legacy projects). Read `.devorch/profile.yml` (per-project first, then `~/.devorch/profile.yml`) and keep its content as `<profile>` for the guardian prompt. If neither exists, use the implicit defaults documented in `docs/PROFILE.md` § Defaults when absent (`priorities: [security, performance, dx, cost]`, no biases).


## Step 2 — Triage (Opus inline, short thinking)

Use short internal thinking (~500–1000 tokens) to classify `$ARGUMENTS` into exactly one mode:

- **quick** — 1–3 known files, explicit action, no design ambiguity. Signals: typo, rename, localized bugfix, config tweak, edit in a clearly identified file.
- **scoped** — 1 module (or a tight set of files within one), feature/fix with legitimate options, narrow exploration suffices (1–3 medium explores, not deep). Signals: bug with multiple possible causes, new endpoint in existing module, small feature, refactor in 1 file.
- **full** — multi-module, new feature, broad refactor, worktree justifiable. Signals: new abstraction, multi-repo, term without precedent in the repo, cross-cutting change (auth, DB schema, API shape).

Output exactly one line: `Classification: <mode> — <1 line justification>`.

**Flag override**: If `--quick` or `--full` is present, honor it regardless of classification and log: "Override: forced `<mode>` by flag."

## Step 3 — Guardian pass (inline, all modes)

Before proposing execution, apply this role internally:

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
> Domain checklist (mnemonic): auth · rate-limiting · input validation · error boundaries · caching · indexing · N+1 · pagination · realtime strategy · upload path · async/queue · observability · idempotency · secrets handling · cross-tenant isolation · multi-repo scope.
>
> **Multi-repo detection**: if `$ARGUMENTS` mentions multiple repo names (e.g. "sync between dochron and dochron-mobile"), or the Step 1 `map-project.ts` output included a `## Sibling Repos` section, or the task implies cross-repo coordination (shared types, API contract changes across client+server), flag this as a real bifurcation with the sibling repos as selectable options. Selected satellites flow into `<secondary-repos>` in the drafted plan and are created as satellite worktrees in F1 Step 8.
>
> If `<profile>` is set: `priorities` ordering breaks bifurcation ties; `biases` are additional hints. On performance-vs-simplicity trade-offs, show cost and let the user choose — do not assume simplicity.
>
> Also consult `.devorch/standards-silenced.md` if present — skip heads-ups matching silenced patterns.

Silence is valid. If no critical heads-up and no real bifurcation exist, proceed without comment.

## Step 4 — Route to mode

Branch on the classification (or the flag override):
- `quick` → Step Q1
- `scoped` → Step S1
- `full` → Step F1

---

## QUICK mode (Steps Q1–Q5)

Trivial edits, 1–3 files, obvious scope. No worktree.

### Q1. Heads-up gate

If the guardian found a critical heads-up, pause and show it using the unified gate format (see Step 5 below). Otherwise proceed silently.

### Q2. Execute edit

Apply the edit directly with Edit/Write tools. Minimal changes. Infer style from nearby code; consult GOTCHAS.md only when relevant to the touched area.

### Q3. Post-edit lint

The post-edit lint hook fires automatically via `PostToolUse`. If it surfaces errors, fix them inline.

### Q4. Commit

Conventional commit, stage only touched files.

### Q5. Report + gotcha capture

One-line report: what changed, commit hash. Then apply the gotcha-capture rule (§ Gotcha capture below). Run the flow-friction capture (§ F9) — typically nothing to log for a clean quick edit. Stop.

---

## SCOPED mode (Steps S1–S8)

1 module, small feature or fix with options. No worktree unless `--worktree` flag.

### S1. Quick explore

Derive a kebab-case `<name>` from `$ARGUMENTS` (3–5 words). Launch **1–3 Explore agents** (`subagent_type="Explore"`, thoroughness **medium**) in parallel — adapt the count and focuses to what the request actually needs: a localized bugfix in a known area may warrant 1 focused explore; a bug with unclear cause across suspect modules, or a small feature touching multiple layers, may warrant 2–3 explores with distinct focuses (e.g. architecture, risks/edges, existing patterns). Err on the side of fewer — scoped mode is meant to be lighter than full (F2 uses 2–3 **very thorough**); if you find yourself wanting more, reconsider whether the request is actually `full`. Wait for all returns before Step S2.

### S2. Enumerate edge cases (3 buckets)

Based on `$ARGUMENTS`, explore findings, GOTCHAS.md (if present), and the guardian pass, enumerate edge cases into 3 buckets:
- **Resolved by code/gotcha/request** — count only
- **Critical heads-up** (guardian) — show with redirect
- **Real bifurcation** — show with A/B/... options and a recommendation

### S3. Transparency block + unified gate

**Skip-when-silent**: if `K + J == 0` (nenhuma bifurcação real e nenhum heads-up crítico após S2), pule este passo por completo — nem bloco de transparência nem `AskUserQuestion`. Siga direto para S4. Princípio 5: zero questions is a valid outcome.

Emit only the counts block (plain markdown — no box-drawing):

```
Edge cases considerados: N
Resolvidos por convenção/código/pedido: M
Bifurcações reais: K
Heads up crítico: J
```

Não liste bifurcações nem heads-ups como texto aqui — eles são apresentados como `AskUserQuestion` diretas no Step 5. Aplique o unified gate (§ Step 5 abaixo).

### S4. Worktree (opt-in)

If `--worktree` flag is present:
1. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name>` and parse JSON.
2. Set `projectRoot = <worktreePath>`. If `.devorch/GOTCHAS.md` (or legacy `.devorch/CONVENTIONS.md`) exists in `mainRoot`, copy it to the worktree.
3. All subsequent edits/commits run with `cwd` = `projectRoot`.

Otherwise `projectRoot = <cwd>`.

### S5. Execute

Apply edits directly with Edit/Write tools in `<projectRoot>`. Follow decisions from the gate. Minimal changes. Post-edit lint hook fires automatically.

### S6. Check

Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`. On failure, fix once; if still failing, report and stop.

### S7. Commit

Conventional commit in `<projectRoot>`, stage only touched files.

### S8. Report + gotcha capture

Concise summary: edge cases count, bifurcations resolved, files changed, check result. Apply the gotcha-capture rule (§ Gotcha capture below). Run the flow-friction capture (§ F9). Stop.

---

## FULL mode (Steps F1–F8)

Multi-module, new feature, or broad refactor. Worktree is mandatory.

### F1. Worktree + plan scaffold

1. Derive `<name>` (kebab-case, 3–5 words) from `$ARGUMENTS`.
2. Record `mainRoot = <cwd>` and `originalBranch = git branch --show-current`.
3. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name>` and parse JSON. Store `worktreePath`, set `projectRoot = worktreePath`.
4. If `<mainRoot>/.devorch/GOTCHAS.md` exists, copy it to `<projectRoot>/.devorch/GOTCHAS.md`. If it doesn't but `<mainRoot>/.devorch/CONVENTIONS.md` exists (legacy), copy it to `<projectRoot>/.devorch/CONVENTIONS.md` — `init-phase.ts` reads both. GOTCHAS.md is opt-in and grows organically (see § Gotcha capture); never auto-generated.

### F2. Deep explore + guardian + gate

1. Launch 2–3 Explore agents (`subagent_type="Explore"`, thoroughness **very thorough**) in parallel with distinct focuses (architecture, risks/edges, existing patterns). Consolidate findings in your own context — do not persist to disk. In F3c you will curate per-task subsets into each builder prompt.
2. Re-run the guardian pass with full exploration context. Enumerate edge cases into the same 3 buckets as scoped mode.
3. Emit the transparency block (see Step S3) and apply the unified gate (§ Step 5). Skip-when-silent applies here too.
4. Draft the plan per `docs/PLAN-FORMAT.md`. Write it to `<projectRoot>/.devorch/plans/<name>.md`. Every task uses `Assigned To: devorch-builder`.

   **Multi-repo detection**: If Step 1 `map-project.ts` included `## Sibling Repos`, `$ARGUMENTS` names multiple repos, or the guardian flagged multi-repo intent, include `<secondary-repos>` in the plan. Siblings are typically at `../<name>/` relative to `<mainRoot>`.

5. Run `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <projectRoot>/.devorch/plans/<name>.md`. Fix issues if blocked.
6. Commit the plan in the worktree: stage `.devorch/plans/<name>.md` plus `.devorch/GOTCHAS.md` (or legacy `.devorch/CONVENTIONS.md`) if either was copied in F1.4, then `git -C <projectRoot> commit -m "chore(devorch): plan — <name>"`.
7. Set `planPath = <projectRoot>/.devorch/plans/<name>.md`.

8. **Satellite worktree setup** (only when plan includes `<secondary-repos>`): parse the list of sibling repos from the plan. Build a JSON array `[{name, path}, ...]` with resolved absolute paths. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name> --add-secondary '<json>'`. Parse the returned `satellites` array and store it as `<satellites>` for F3e and F7. If any satellite fails to create (missing repo, uncommitted changes, branch collision), stop and surface the error — do not proceed to F3.

### F3. Phase loop

For each phase N sequentially:

#### F3a. Init phase
Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N`. Parse JSON. If `contentFile` is present, read it for full context.

#### F3b. Filter size gate
Read `sliceWarnings` from the init-phase JSON output (authoritative thresholds: <3K = `under`, >30K = `over`). The init-phase check sizes only what the script can see (gotchas + specs + code structure) — it runs **before** F3c curates and injects F2 Explore Findings into each builder prompt, so `under` warnings are expected whenever you have relevant findings queued for injection.

Handling per direction:
- **`under`** — for each warning, decide if the Explore Findings you plan to inject for that task in F3c will materially raise the effective slice size. If yes, auto-resolve silently and log a single line: `Slice <task-id> marcado under (<N>K); vou engordar via Explore Findings na F3c.` If no injection is planned for that task (or the planned injection is trivial), pause and offer the user: continue / split the task / re-curate the slice (narrow gotchas, tighten specs) / inject additional findings.
- **`over`** — always pause. Show task id, approximate token count, and offer: continue / split the task / trim the slice (narrow gotchas, tighten specs, reduce injected findings).

Do not dispatch builders until every remaining warning is either auto-resolved (with the log line) or explicitly accepted by the user.

#### F3c. Dispatch builders (parallel waves)
For each wave from the init-phase output, launch all `taskIds` in a single message via the Task tool, each with `subagent_type="devorch-builder"`. Issue one Task tool call per task inside the same assistant message so they run in parallel.

Each builder prompt includes: `Working directory: <projectRoot>`, Plan Objective + Solution Approach + Decisions, full task details, `## Gotchas` (from init-phase `gotchas` field, if non-empty), `## Code Structure` (if non-empty), `## Exemplars` (if non-empty), `## Spec Contracts` (if non-empty), `## Non-goals` (if non-empty), and `## Explore Findings` — the subset of F2 explore results you judge relevant to this specific task (files mentioned, patterns touched). Order: Gotchas → Code Structure → Exemplars → Spec Contracts → Non-goals → Explore Findings.

After each wave returns: verify task completion via `TaskList`, extract `## Build Report` blocks from each builder's output (regex from `## Build Report` to the next `##` header), key them by task-id. For each successful task (matching commit in `git log`), call `TaskUpdate` with `status: "completed"`.

**Multi-repo tasks**: when `<satellites>` is non-empty and a task has `Repo: <name>` matching a satellite, prepend to the builder prompt: `Working directory: <satellite.worktreePath>` and `Use git -C <satellite.worktreePath> for all git commands`. Tasks without `Repo:` (or with `Repo: primary`) use `<projectRoot>` as their working directory.

**On builder failure** (no matching commit or reported failure): retry per task (max 3 attempts). Each retry appends a `## Previous Failure Context` section to the builder prompt: retry count, last 50 lines of prior output, git diff from the failed attempt (or "no commits"), and an instruction to diagnose the root cause. On retry exhaustion: stop the phase, emit a structured failure report and suggest `/devorch --full` re-planning.

**On agent resolution failure** (Task tool returns `Agent type not found` and no commit was made): the agent is not registered in the current session — typically because it was installed after session start. Do not count as a failure or consume a retry slot. Surface the session-registration issue to the user and suggest restarting Claude Code after `bun install.ts`.

#### F3d. Per-phase check
If `totalPhases > 1`: run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`. Fix all errors or report and stop.

#### F3e. Phase summary + commit
- `bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan <planPath> --phase N --status "ready for phase $((N+1))" --summary "<concise>" [--satellites '<json>']` — include `--satellites` only when `<satellites>` is non-empty (build JSON as `[{name, path}, ...]` from the F2.8 output).
- Commit with the returned message if there are changes in the primary worktree. For each satellite, also commit phase progress if it has changes: `git -C <satellite.worktreePath> add -A && git -C <satellite.worktreePath> commit -m "<phase-summary-message>"`.

### F4. Categorized adversarial review

After all phases complete, determine changed files via `git -C <projectRoot> diff --name-only <originalBranch>...HEAD`. Grep for `TODO|FIXME|HACK|XXX` across changed files (residual scan).

Launch 4 reviewers in parallel (`subagent_type="Explore"`, foreground, single message). All receive: `Working directory: <projectRoot>`, plan objective, GOTCHAS.md (or legacy CONVENTIONS.md) if it exists, changed-files list. Each reviewer should also flag non-obvious behaviors discovered in the changed code as gotcha candidates in their report.

- **security** — OWASP Top 10 anti-patterns, injection risks, auth gaps, data exposure, secrets handling
- **performance** — estimated cost, anti-patterns (N+1, full scans, polling, synchronous workers, server-side buffering), cache opportunities
- **completeness** — spec vs delivery: every `<spec>` element satisfied? cross-phase integration intact? handoffs honored?
- **flags** — adjacent items out of scope. For each flag: type (security | performance | architecture | ops), severity, detection (file:line), suggested fix, one-line alternative. Write all flags to `<mainRoot>/.devorch/flags-<name>.md` using the FLAGS.md format.

### F5. Apply review fixes

Classify each finding:
- **Trivial** (1–2 files, obvious fix) → apply inline with Edit.
- **Fix-level** (well-defined, 3+ files or non-trivial) → launch `devorch-builder` agents in parallel.
- **Talk-level** (needs design) → do not fix; leave as a pending item plus a suggested `/devorch --full` prompt.

Skip review execution entirely if all reviewers and residual scan reported zero findings. After fixes, run `check-project.ts <projectRoot>` (full if fix-level launched, `--quick` if trivial only). One retry on failure.

### F6. Verdict report

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
<talk-level items com prompt /devorch --full sugerido ou "Nenhum">

### Verdict: PASS / PASS com N pendências / FAIL
```

### F7. Merge flow

If verdict is PASS (or PASS with pendencies that are non-blocking), run the merge-worktree script from `<mainRoot>`:

```
bun $CLAUDE_HOME/devorch-scripts/merge-worktree.ts --worktree <name> [--satellites '<json>']
```

Pass `--satellites '<json>'` only when `<satellites>` is non-empty (same JSON shape built in F3e). The script rebases the primary worktree onto `origin/<mainBranch>`, runs `check-project --quick`, dry-runs merges across primary + all satellites BEFORE committing anything (atomicity guard), then merges sequentially with `--no-ff`, archives the plan, removes each worktree, and deletes each branch. Single call covers the full lifecycle.

Optional flags: `--squash`, `--keep-branch`, `--no-rebase`, `--dry-run`.

Parse JSON output and route by `ok`:
- `ok: true` → iterate `repos[]`: for each entry report `role` (primary / satellite), `name`, `merged` (merge commit sha), `commitsIntegrated`, `filesChanged`. Also surface `planArchivedTo`, `planActiveCleaned` (stale active copy removed from `mainRoot`), `archivalCommit` (the commit sha recording the active→archive transition), and, when the merged repo was devorch itself, `selfBuildInstalled` (the script auto-re-runs `install.ts` after a devorch self-merge). Done.
- `ok: false` → route by `phase`:
  - `"rebase"` → rebase conflict in a specific repo; surface `failedRepos[].conflictFiles` and instruct manual resolution.
  - `"dry-run"` → one or more repos' merge dry-run failed; list them with conflict files. No repo was merged (atomicity guard). Preserve all worktrees.
  - `"merge"` → a merge failed after dry-run passed (rare: concurrent writes to main); surface `okRepos[]` (already merged) and `failedRepos[]` (pending). Prompt user to resolve.
  - `"cleanup"` → merge succeeded but worktree/branch removal failed; surface for manual cleanup.

Plan archival is done inside `merge-worktree.ts`. Self-build install (when the merged repo's `package.json` has `"name": "devorch"`) is also handled inside the script — it re-runs `install.ts` from `mainRoot` so `~/.claude/{agents,commands,devorch-scripts,hooks}` reflect the merged state. Nothing extra to run.

On FAIL → do not merge, preserve worktrees, suggest `/devorch --resume` to retry or `/devorch --full "<fix description>"` for a new attempt.

### F8. Gotcha capture (full mode)

Apply the gotcha-capture rule (§ Gotcha capture below). Full mode has the richest signal — builder retries, reviewer surprises, guardian flags on untyped contracts — so this step is especially valuable here.

### F9. Flow friction capture (todos os modos)

Roda antes do report final. Captura atritos no próprio fluxo do devorch — não em código do usuário. Conta: script errou ou retornou JSON malformado, retry loop precisou >1 tentativa, gate precisou ser reinvocado, hook não disparou quando devia, você improvisou porque a instrução estava ambígua, bifurcação sem precedente nem resposta da indústria.

**Inbox path** (primeiro que casar): `$DEVORCH_REPO/.devorch/flow-issues-inbox/` → `../devorch/.devorch/flow-issues-inbox/` → `<mainRoot>/.devorch/flow-issues-inbox/`.

**Um arquivo por atrito**, nomeado `<YYYY-MM-DD>-<slug>.md`, contendo: título, timestamp, `Mode`, `Severity` (blocker/gap/nit), prompt pronto (`/devorch ... "<fix>"`), contexto mínimo (onde/o que aconteceu/esperado/workaround).

**Zero atritos**: não escreva nada e omita qualquer menção no report. **≥1 atrito**: adicione ao report `### Flow friction capture: N item(s) em <inbox-path>/`.

---

## Step 5 — Unified gate UX (used by quick, scoped, and full)

**Precondition**: este gate só roda quando há pelo menos uma bifurcação real ou um heads-up crítico (`K + J > 0`). Se ambos forem zero, Q1/S3/F2 já terão pulado este passo silenciosamente — não invoque `AskUserQuestion` apenas para confirmar defaults. Se só heads-ups existirem (`J > 0`, `K == 0`), rode apenas o heads-up pass; se só bifurcações existirem (`K > 0`, `J == 0`), rode apenas o bifurcations pass.

### Heads-up pass (quando `J > 0`)

Antes da pergunta, emita a lista dos heads-ups como markdown simples (não inclua na pergunta — mantém a pergunta curta):

```
Heads-ups críticos:
1. <título curto> — `file:line` (se conhecido) — <motivo/redirect em 1 linha>
2. ...
```

Então faça **uma única** `AskUserQuestion` agregando todos os heads-ups:

- `question`: "Quer comentar algo sobre os heads-ups acima, ou sigo com as correções recomendadas?"
- `header`: "Heads-ups"
- `multiSelect`: false
- `options` (2 opções; o botão **Other** — gerado automaticamente pela ferramenta — é o canal para escrever comentário ou override livre):
  - label `"Seguir recomendações"`, description: "Aplicar todas as correções recomendadas pelos heads-ups acima sem input adicional."
  - label `"Pular heads-up(s)"`, description: "Preservar o código atual ignorando uma ou mais recomendações. Use 'Other' para indicar quais números pular e por quê."

Se o usuário escolher "Other" e escrever texto livre, trate o conteúdo como override ou comentário — ajuste o plano/execução de acordo antes de prosseguir.

### Bifurcations pass (quando `K > 0`)

Cada bifurcação vira uma pergunta dedicada em `AskUserQuestion` (até 4 perguntas por chamada; se `K > 4`, pagine em rounds sucessivos). Não há etapa intermediária de "quais clarificar" — todas são perguntadas.

Cada pergunta deve seguir estas regras de clareza (o problema atual é que perguntas curtas demais deixam dúvida sobre o que está sendo decidido):

- `question`: 2–4 frases. Comece contextualizando **onde** a decisão incide (arquivo, módulo, feature, endpoint), **o que** está em jogo (qual comportamento/propriedade muda conforme a escolha), e **por que** precisa decidir agora. Termine com a pergunta objetiva. A pergunta deve ser inteligível lida isoladamente — sem depender do transparency block nem de contexto anterior.
- `header`: 1–2 palavras que nomeiam o eixo da decisão (ex.: "Sessão", "Cache", "Multi-repo", "Paginação").
- `multiSelect`: false, salvo quando a bifurcação for legitimamente multi-select (ex.: quais satélites incluir).
- `options`: 2–4 opções A/B/... Cada opção com:
  - `label` — 1–5 palavras nomeando a abordagem (ex.: "Cookie httpOnly", "JWT em memória"). Marque a recomendada como **primeira opção** com sufixo ` (recomendada)` no label.
  - `description` — 2–3 frases cobrindo: (1) o que a opção faz concretamente na implementação; (2) o trade-off principal (custo, complexidade, risco, performance); (3) quando ela é preferível. Na opção recomendada, inclua o motivo da recomendação (priorities do profile, convenção do repo, anti-pattern evitado).

Exemplo de pergunta bem formada:

> question: "A nova rota `/api/session` precisa decidir onde o token de sessão vive no cliente. Essa escolha impacta tanto segurança (exposição a XSS) quanto UX em refresh. Qual estratégia de storage usar?"
> header: "Sessão"
> options:
>   - label "Cookie httpOnly (recomendada)", description: "Gravar o token em cookie httpOnly + SameSite=Strict; backend lê via header automático. Evita exposição a XSS ao custo de exigir CSRF token em forms. Preferível por alinhar com a `priority: security` do profile."
>   - label "localStorage", description: "JS lê/escreve o token em `localStorage`. Implementação mais simples e sobrevive a refresh, mas qualquer XSS rouba a sessão inteira. Escolha só se CSRF for caro e risco XSS for mitigado por outro meio."

Zero questions é resultado válido — se `K == 0` e `J == 0`, Q1/S3/F2 já pularam esta fase inteira.

## Gotcha capture

Gotchas are invariants the code does not self-document — non-obvious behaviors a fresh reader would discover only by hitting a bug. GOTCHAS.md is never auto-generated; it grows organically from real sessions. Each entry earns its place.

**When to offer capture** (accumulate candidates during the run, prompt once at report time):

- **Quick mode**: the edit required reading non-adjacent files to understand a behavior, OR a type/interface did not describe real runtime state.
- **Scoped mode**: any of the above, OR the guardian flagged an invariant not enforced by types/tests/linter, OR a retry happened because of surprise behavior.
- **Full mode**: any of the above across builders, OR an F4 reviewer (security / performance / completeness / flags) explicitly marked a finding as "this surprised me" or "non-obvious", OR a builder hit a retry caused by undocumented behavior.

**Candidate quality bar** (each candidate must satisfy all three):
1. **File:line reference** — where the behavior lives.
2. **"Why it surprises"** — one sentence a fresh reader needs. If you can't write this sentence, it is not a gotcha.
3. **Not covered by types, tests, linter, or obvious code reading** — otherwise it's normal code, not a gotcha.

**How to prompt**: zero candidates → silent skip (no mention in report). One or more candidates → single `AskUserQuestion` with options per candidate (Add / Skip) and a free "Add all / Skip all" path. Keep wording concise; show file:line + one-line why per candidate.

**Writing**: append accepted candidates to `<projectRoot>/.devorch/GOTCHAS.md` (create if missing). Use this shape:

```
# Gotchas

- **<short title>** (`file:line`) — <one-line why it surprises>.
```

Append-only; never rewrite existing entries. Commit the change with `chore(devorch): gotcha — <short title>` (one commit per session, not per candidate).

**Prune on demand, not automatically**: staleness is not detected by script. If the user runs `/devorch --full "review gotchas"`, treat that as a full-mode request to read each entry against current code and propose removals for ones that no longer apply.

## Worktree policy

- `quick` → no worktree; edits in `cwd`.
- `scoped` → no worktree by default; `--worktree` opt-in creates one via `setup-worktree.ts`.
- `full` → worktree **mandatory**, created before the plan in Step F1.
- Naming: `.worktrees/<name>` where `<name>` is kebab-case (3–5 words derived from `$ARGUMENTS`).
- Branch: `devorch/<name>`.
- Merge: via `merge-worktree.ts` (rebase → check → review → `--no-ff` → cleanup).

## Rules

- Do not narrate actions. Execute directly without preamble.
- The orchestrator reads `.devorch/*` files and Explore/review agent output; it does not read source files directly (except for applying trivial fixes in full-mode review F5 and for quick/scoped edits in Q2/S5).
- All `git` and `bun` commands during full-mode phase execution run with `cwd = <projectRoot>` (or `git -C <projectRoot>`).
- Silence is valid in the guardian pass — do not fabricate heads-ups.
- Post-edit lint hook is always active across modes.
- **Language policy**: User-facing output (questions, reports, summaries) in Portuguese pt-BR with correct accentuation. Code, git commits, internal files, and technical comments in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese sentences.
- **Output format**: Plain markdown only. No box-drawing, no ASCII art, no decorative characters.
- Coexists with `/devorch:talk|build|fix` — existing v2 plans continue to work through those commands.
