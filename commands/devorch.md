---
description: "Plan-driven build with adaptive explore waves + adversarial review"
argument-hint: "[--resume] <what to do>"
model: opus
effort: xhigh
disallowed-tools: EnterPlanMode
---

Single-mode entry point for devorch. Use it whenever you need orchestration of medium-to-large work — for trivial edits (single-file typo, rename in a known location), use vanilla Claude Code; devorch's ceremony does not pay off there.

Pipeline is linear: load context → worktree → guardian pass → wave 1 explore (always) → wave 2 explore (conditional) → enumerate edge cases → plan → validate → phase loop with builders → adversarial review → apply fixes → verdict → merge → gotcha capture → flow friction capture.

**Input**: `$ARGUMENTS` — description plus optional flag:
- `--resume` — resume an active worktree (no description needed)

After stripping `--resume`, if the remaining `$ARGUMENTS` is empty and `--resume` is not set, stop and ask the user.

## Step 0 — Resume short-circuit

If `--resume` is present:
1. Run `bun $CLAUDE_HOME/devorch-scripts/list-worktrees.ts` and parse JSON.
2. If `count == 0` → report "Nenhum worktree ativo para retomar." and stop.
3. If `count == 1` → resume that worktree directly. If `count > 1` → `AskUserQuestion` presenting each worktree (name + plan title) and pick one.
4. Once a worktree is chosen, establish full resume context before jumping to Step 9 (phase loop):
   - `mainRoot = <cwd>` (the main repo root where `.worktrees/` lives)
   - `projectRoot = .worktrees/<name>`
   - `<name> = basename(projectRoot)`
   - `planPath` = the first `.md` under `<projectRoot>/.devorch/plans/` (excluding `archive/`)
   - `originalBranch` = run `git -C <mainRoot> symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo main` and strip `origin/` prefix; fall back to `main` or `master` as available.
5. Jump to Step 9 (phase loop) with these bindings. Note: on resume, the in-memory explore findings from the original waves are gone — builders will still receive gotchas + specs + code structure, and you may launch a fresh Explore agent from Step 9 if a task needs broader context.

## Step 1 — Load context

Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` to collect folder structure, scripts, and sibling repos inline. Read `.devorch/GOTCHAS.md` if it exists (fall back to `.devorch/CONVENTIONS.md` for legacy projects). Read `.devorch/profile.yml` (per-project first, then `~/.devorch/profile.yml`) and keep its content as `<profile>` for the guardian prompt. If neither exists, use the implicit defaults documented in `docs/PROFILE.md` § Defaults when absent (`priorities: [security, performance, dx, cost]`, no biases).

## Step 2 — Worktree

1. Derive `<name>` (kebab-case, 3–5 words) from `$ARGUMENTS`.
2. Record `mainRoot = <cwd>` and `originalBranch = git branch --show-current`.
3. If the original branch has uncommitted changes (`git -C <mainRoot> status --porcelain` returns non-empty), surface them in a one-line note: `WIP no branch original: <N> arquivo(s) — preservados em <mainRoot>, não entram no worktree.` The user's WIP stays untouched on the original branch; the worktree starts from HEAD.
4. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name>` and parse JSON. Store `worktreePath`, set `projectRoot = worktreePath`.
5. If `<mainRoot>/.devorch/GOTCHAS.md` exists, copy it to `<projectRoot>/.devorch/GOTCHAS.md`. If it doesn't but `<mainRoot>/.devorch/CONVENTIONS.md` exists (legacy), copy it to `<projectRoot>/.devorch/CONVENTIONS.md` — `init-phase.ts` reads both. GOTCHAS.md grows organically from session signal (see § Gotcha capture).

All subsequent edits, commits, and `git`/`bun` invocations during the build run with `cwd = <projectRoot>` (or `git -C <projectRoot>`).

## Step 3 — Guardian pass (inline)

Apply this role internally before any explore:

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
> **Multi-repo detection**: if `$ARGUMENTS` mentions multiple repo names (e.g. "sync between dochron and dochron-mobile"), or the Step 1 `map-project.ts` output included a `## Sibling Repos` section, or the task implies cross-repo coordination (shared types, API contract changes across client+server), flag this as a real bifurcation with the sibling repos as selectable options. Selected satellites flow into `<secondary-repos>` in the drafted plan and become satellite worktrees in Step 8.
>
> If `<profile>` is set: `priorities` ordering breaks bifurcation ties; `biases` are additional hints. On performance-vs-simplicity trade-offs, show cost and let the user choose — do not assume simplicity.
>
> Also consult `.devorch/standards-silenced.md` if present — skip heads-ups matching silenced patterns.

The guardian pass runs inline. Silence is valid: if no critical heads-up and no real bifurcation surface here, proceed without comment. The guardian pass re-runs after Step 5 with fuller context; at this stage it operates only on `$ARGUMENTS` + map-project + GOTCHAS.

## Step 4 — Wave 1 explore (always)

Launch **1–2 Explore agents** in parallel (`subagent_type="Explore"`, thoroughness **medium**) with a fixed broad focus:

- **Agent 1 — architecture + existing patterns**: how the touched area is organized today, what conventions and abstractions already exist that the build must respect or mirror.
- **Agent 2 (optional, only if the request spans 2+ modules) — risks/edges**: failure modes, edge cases, integration surfaces adjacent to the touched area.

Wave 1 is deliberately broad and cheap. Do not invent custom focuses here — that is wave 2's job. Wave 1 is the baseline that lets the orchestrator judge whether wave 2 is needed.

Wait for all wave 1 agents to return before deciding Step 5.

## Step 5 — Wave 2 explore (conditional)

Read wave 1 findings. Decide if any of these gatilhos apply (silently — do not interrupt the user):

1. Wave 1 cited a relevant file or contract but did not actually read it.
2. A pattern is ambiguous between two paths in the codebase — picking one without depth would be a guess.
3. A risk was identified but its blast radius (which other modules / endpoints / consumers touch it) is unmapped.
4. Multi-repo: wave 1 only saw the primary; satellite still needs focused exploration.
5. The `$ARGUMENTS` references a contract / spec / behavior that wave 1 did not locate.

If **zero gatilhos** apply → log one line: `Wave 2: skipped — wave 1 cobriu <X, Y, Z>.` Skip Step 5 entirely.

If **at least one gatilho** applies → launch up to **2 Explore agents** (`subagent_type="Explore"`, thoroughness **very thorough**), each with a focus extracted from a specific gatilho. Log before dispatch: `Wave 2: <N> agent(s) focados em <gatilho> — motivo: <one-line>.`

**Hard cap**: 4 explore agents total per session (wave 1 + wave 2 combined). If you reach the cap and still feel under-informed, that is a signal the request itself is malformed — surface it to the user instead of launching more.

After wave 2 returns, consolidate all findings (wave 1 + wave 2) in your own context. Do not persist to disk — Step 9c will curate per-task subsets into each builder prompt.

Re-run the guardian pass internally with the fuller exploration context to refine bifurcations and heads-ups for Step 6.

## Step 6 — Enumerate edge cases + unified gate

Based on `$ARGUMENTS`, explore findings, GOTCHAS.md (if present), and the guardian pass, enumerate edge cases into 3 buckets:

- **Resolved by code/gotcha/request** — count only
- **Critical heads-up** (guardian) — show with redirect
- **Real bifurcation** — show with A/B/... options and a recommendation

**Skip-when-silent**: if `K + J == 0` (no real bifurcations, no critical heads-ups), skip this step entirely — neither the transparency block nor `AskUserQuestion`. Go straight to Step 7. Zero questions is a valid outcome (Principle 5).

Otherwise emit only the counts block (plain markdown — no box-drawing):

```
Edge cases considerados: N
Resolvidos por convenção/código/pedido: M
Bifurcações reais: K
Heads up crítico: J
```

Do not list bifurcations or heads-ups as text here — they are surfaced as `AskUserQuestion` directly via the unified gate (§ Unified gate UX below).

## Step 7 — Plan

Always write a plan. Even a build of 2 files gets a plan with 1 phase / 1 task — the plan is the source of truth for parallelization decisions, wave dependencies, builder context, and the completeness reviewer in Step 10.

Draft the plan per `docs/PLAN-FORMAT.md`. Write it to `<projectRoot>/.devorch/plans/<name>.md`. Every task uses `Assigned To: devorch-builder`.

**Multi-repo detection**: if Step 1 `map-project.ts` included `## Sibling Repos`, or `$ARGUMENTS` names multiple repos, or the guardian flagged multi-repo intent and the user selected satellites in Step 6, include `<secondary-repos>` in the plan. Siblings are typically at `../<name>/` relative to `<mainRoot>`.

The plan must reflect decisions captured in Step 6 — every user choice goes in `<decisions>` as a "Question → Answer" line.

## Step 7.5 — Plan semantic check

`validate-plan.ts` (Step 8) is a syntactic gate: it parses the plan and checks structural rules (waves declared, ids unique, `<relevant-files>` non-overlapping within a wave). It cannot infer **implicit** touches — files a task will edit that are not listed in `<relevant-files>` because the task description treats them as obvious (a barrel re-export, a hook registry, a generated migration filename, an index aggregator). Two tasks in the same wave that both implicitly touch `src/index.ts` will pass `validate-plan.ts` and then collide at build time.

Step 7.5 catches those before the syntactic gate runs. It is pure orchestrator-side reasoning + mechanical grep — no script. Run it after Step 7 has written the plan to disk and before Step 8 invokes `validate-plan.ts`.

For each task in the plan, perform the four sub-rules:

1. **Implicit-touch inference (LLM judgment)** — read the task description and `<relevant-files>`. List candidate implicit touches the task will likely modify even though they are not in `<relevant-files>`. Common shapes:
   - Barrel files / index aggregators (`src/index.ts`, `src/lib/index.ts`, `mod.ts`) when the task adds or renames an exported symbol.
   - Hook registries (`hooks/index.ts`, `useFoo` registries) when the task adds a hook.
   - Plugin / command / route registries when the task adds a new entry.
   - Migration filenames (`db/migrations/NNNN_*.sql`) when the task adds a schema change — even if the exact filename is generated.
   - Type re-exports (`types.ts`, `index.d.ts`) when the task adds a new type that other modules import.

2. **Grep verification (deterministic)** — for each candidate from sub-rule 1, run a Bash grep against the worktree to confirm the file actually exists and is plausibly touched. Example: `git -C <projectRoot> ls-files | grep -E '(^|/)index\.ts$'` to enumerate barrels, or `grep -rn "export \* from" <projectRoot>/src` to find re-export sites. Do not propagate a candidate that grep cannot confirm.

3. **Silent re-wave (overlap resolution)** — if two or more tasks in the same wave share a verified implicit touch, move the later tasks to a subsequent wave so each wave's effective file set (declared + implicit) stays disjoint. Rewrite the plan file in place, then log a single line — no `AskUserQuestion`, no user gate. Example log line:
   ```
   Wave reorganizada: tasks 2 e 4 dividem src/index.ts implícito.
   ```
   This is the expected case: implicit overlap is mechanical, not a design decision. The orchestrator resolves it without consulting the user.

4. **Migration collision check (cross-wave)** — for each repo (primary + each entry in `<satellites>`) that has at least one task adding a migration, list the migration filenames committed on the base branch via `git -C <repo> ls-tree origin/<mainBranch>:<satellite>/db/migrations/` (use the satellite-specific path when the task is on a satellite; for the primary repo use `git -C <projectRoot> ls-tree origin/<mainBranch>:db/migrations/` or whatever migrations directory the repo uses). If a planned migration filename collides with an existing one on origin, auto-bump the planned filename's numeric prefix to the next free slot and rewrite the plan accordingly. Log a single line: `Migration bumped: NNNN → MMMM em <repo> (collision com origin/<mainBranch>).`

After sub-rules run, the plan file on disk reflects any re-waves and migration bumps. Step 8 then runs against the rewritten plan.

**Rare case — genuine bifurcation surfaces here**: if Step 7.5 discovers a real ambiguity that requires user input (e.g., two tasks both want to own the same exported symbol and the resolution is a design choice, not just sequencing), surface it via the unified gate (§ Unified gate UX) as a late bifurcation. Step 6's gate already passed for the originally-known bifurcations; this is the rare path where new context (the implicit touches) reveals a bifurcation that wasn't visible during Step 6. In practice this is uncommon — most overlaps are sequencing-only and resolved silently by sub-rule 3.

## Step 8 — Validate plan + commit + satellite worktrees

1. Run `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <projectRoot>/.devorch/plans/<name>.md`. Fix issues if blocked (waves with overlap, missing fields, etc.).
2. Commit the plan in the worktree: stage `.devorch/plans/<name>.md` plus `.devorch/GOTCHAS.md` (or legacy `.devorch/CONVENTIONS.md`) if either was copied in Step 2, then `git -C <projectRoot> commit -m "chore(devorch): plan — <name>"`.
3. Set `planPath = <projectRoot>/.devorch/plans/<name>.md`.
4. **Satellite worktree setup** (only when plan includes `<secondary-repos>`): parse the list of sibling repos from the plan. Build a JSON array `[{name, path}, ...]` with resolved absolute paths. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name> --add-secondary '<json>'`. Parse the returned `satellites` array and store it as `<satellites>` for Steps 9 and 13. If any satellite fails to create (missing repo, uncommitted changes, branch collision), stop and surface the error — do not proceed to Step 9.

## Step 9 — Phase loop

For each phase N sequentially:

### 9a. Init phase
Before invoking `init-phase.ts`, estimate the token count of the `## Explore Findings` subset you intend to inject into each task's builder prompt in 9c (consolidated wave 1 + wave 2 findings filtered per task). Build a JSON object keyed by task-id with the per-task estimate, e.g. `{"task-a": 1200, "task-b": 0}`. On the resume path (Step 4–5), the original waves are gone — pass `{}`.

Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N --explore-injection-tokens '<json>'`. Parse JSON. If `contentFile` is present, read it for full context.

### 9b. Filter size gate
Read `sliceWarnings` from the init-phase JSON output (authoritative thresholds: <3K = `under`, >30K = `over`). The init-phase check sizes only what the script can see (gotchas + specs + code structure) — it runs **before** Step 9c curates and injects Explore Findings into each builder prompt, so `under` warnings are expected whenever you have relevant findings queued for injection.

Handling per direction:
- **`under`** — for each warning, decide if the Explore Findings you plan to inject for that task in 9c will materially raise the effective slice size. If yes, auto-resolve silently and log a single line: `Slice <task-id> marcado under (<N>K); vou engordar via Explore Findings na 9c.` If no injection is planned for that task (or the planned injection is trivial), pause and offer the user: continue / split the task / re-curate the slice (narrow gotchas, tighten specs) / inject additional findings.
- **`over`** — always pause. Show task id, approximate token count, and offer: continue / split the task / trim the slice (narrow gotchas, tighten specs, reduce injected findings).

Do not dispatch builders until every remaining warning is either auto-resolved (with the log line) or explicitly accepted by the user.

### 9c. Dispatch builders (parallel waves)
For each wave from the init-phase output, launch all `taskIds` in a single message via the Task tool, each with `subagent_type="devorch-builder"`. Issue one Task tool call per task inside the same assistant message so they run in parallel.

Each builder prompt includes: `Working directory: <projectRoot>`, Plan Objective + Solution Approach + Decisions, full task details, `## Gotchas` (from init-phase `gotchasByTask[task-id]` field — omit the section entirely if empty for that task), `## Code Structure` (if non-empty), `## Exemplars` (if non-empty), `## Spec Contracts` (if non-empty), `## Non-goals` (if non-empty), and `## Explore Findings` — the subset of wave 1 + wave 2 results you judge relevant to this specific task (files mentioned, patterns touched). Order: Gotchas → Code Structure → Exemplars → Spec Contracts → Non-goals → Explore Findings.

After each wave returns: verify task completion via `TaskList`, extract `## Build Report` blocks from each builder's output (regex from `## Build Report` to the next `##` header), key them by task-id. For each successful task (matching commit in `git log`), call `TaskUpdate` with `status: "completed"`.

**Multi-repo tasks**: when `<satellites>` is non-empty and a task has `Repo: <name>` matching a satellite, prepend to the builder prompt: `Working directory: <satellite.worktreePath>` and `Use git -C <satellite.worktreePath> for all git commands`. Tasks without `Repo:` (or with `Repo: primary`) use `<projectRoot>` as their working directory.

**On builder failure** (no matching commit or reported failure): retry per task (max 3 attempts). Each retry appends a `## Previous Failure Context` section to the builder prompt: retry count, last 50 lines of prior output, git diff from the failed attempt (or "no commits"), and an instruction to diagnose the root cause. On retry exhaustion: stop the phase, emit a structured failure report and suggest a fresh `/devorch` invocation for re-planning.

**On agent resolution failure** (Task tool returns `Agent type not found` and no commit was made): the agent is not registered in the current session — typically because it was installed after session start. Do not count as a failure or consume a retry slot. Surface the session-registration issue to the user and suggest restarting Claude Code after `bun install.ts`.

### 9d. Per-phase check
If `totalPhases > 1`: run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`. Fix all errors or report and stop. (`--quick` here is a flag of `check-project.ts` — lint + typecheck only — not a mode of devorch.)

### 9e. Phase summary + commit
- `bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan <planPath> --phase N --status "ready for phase $((N+1))" --summary "<concise>" [--satellites '<json>']` — include `--satellites` only when `<satellites>` is non-empty (build JSON as `[{name, path, status}, ...]` where `path` is the satellite's `repoPath` (from Step 8.4 output's `satellites[].repoPath`)).
- `phase-summary.ts` only uses `name` + `status`; the `path` field is carried for symmetry with `merge-worktree` and ignored here.
- Commit with the returned message if there are changes in the primary worktree. For each satellite, also commit phase progress if it has changes: `git -C <satellite.worktreePath> add -A && git -C <satellite.worktreePath> commit -m "<phase-summary-message>"`.

## Step 10 — Adversarial review

After all phases complete, determine changed files via `git -C <projectRoot> diff --name-only <originalBranch>...HEAD`. Grep for `TODO|FIXME|HACK|XXX` across changed files (residual scan).

Launch 4 reviewers in parallel (`subagent_type="Explore"`, foreground, single message). All receive: `Working directory: <projectRoot>`, plan objective, GOTCHAS.md (or legacy CONVENTIONS.md) if it exists, changed-files list. Each reviewer should also flag non-obvious behaviors discovered in the changed code as gotcha candidates in their report.

**Anti-staleness directive (included in every reviewer prompt)**: read file contents at current HEAD of the worktree, not the base branch. Cite `file:line` from the current state. Before reporting a contract as unsatisfied, grep for the expected new symbol or phrase (e.g. the behavior name, the added function, the new flag) in the actual file. A reviewer reporting "not implemented" without such a grep check is treated as stale and re-run.

- **security** — OWASP Top 10 anti-patterns, injection risks, auth gaps, data exposure, secrets handling
- **performance** — estimated cost, anti-patterns (N+1, full scans, polling, synchronous workers, server-side buffering), cache opportunities
- **completeness** — spec vs delivery: every `<spec>` element satisfied? cross-phase integration intact? handoffs honored? Required method: for each `<behavior>`/`<invariant>` in the plan, grep the changed files for its identifying symbol (function name, flag name, new phrase) AND verify with a direct Read on the relevant line range. Do not infer from absence at a master-era line number.
- **flags** — adjacent items out of scope. For each flag: type (security | performance | architecture | ops), severity, detection (file:line), suggested fix, one-line alternative. Write all flags to `<mainRoot>/.devorch/flags-<name>.md` using the FLAGS.md format.

## Step 11 — Apply review fixes

Antes de classificar e dispatchar, compute a união de `<relevant-files>` de cada finding fix-level (via grep do conteúdo da finding ou inspeção direta dos arquivos citados). Se dois ou mais findings tocarem o mesmo arquivo, eles NÃO podem ser dispatchados no mesmo wave — sequencialize em waves separados, espelhando a disciplina que `validate-plan.ts` aplica em Step 9c. Findings sem overlap de arquivos seguem em paralelo.

Classify each finding:
- **Trivial** (1–2 files, obvious fix) → apply inline with Edit.
- **Fix-level** (well-defined, 3+ files or non-trivial) → launch `devorch-builder` agents in parallel (respecting non-overlap).
- **Talk-level** (needs design) → do not fix; leave as a pending item plus a suggested fresh `/devorch` prompt.

Skip review execution entirely if all reviewers and residual scan reported zero findings. After fixes, run `check-project.ts <projectRoot>` (full if fix-level launched, `--quick` if trivial only). One retry on failure.

## Step 12 — Verdict report

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

## Step 13 — Merge flow

If verdict is PASS (or PASS with pendencies that are non-blocking), run the merge-worktree script from `<mainRoot>`:

```
bun $CLAUDE_HOME/devorch-scripts/merge-worktree.ts --worktree <name> [--satellites '<json>']
```

Pass `--satellites '<json>'` only when `<satellites>` is non-empty (same JSON shape built in Step 9e) — namely `[{name, path, status?}, ...]` where `path` is `repoPath`; `merge-worktree.ts` resolves `.worktrees/<name>` internally from that path. The script rebases the primary worktree onto `origin/<mainBranch>`, runs `check-project --quick`, dry-runs merges across primary + all satellites BEFORE committing anything (atomicity guard), then merges sequentially with `--no-ff`, archives the plan, removes each worktree, and deletes each branch. Single call covers the full lifecycle.

Optional flags: `--squash`, `--keep-branch`, `--no-rebase`, `--dry-run`.

Parse JSON output and route by `ok`:
- `ok: true` → iterate `repos[]`: for each entry report `role` (primary / satellite), `name`, `merged` (merge commit sha), `commitsIntegrated`, `filesChanged`. Also surface `planArchivedTo`, `planActiveCleaned` (stale active copy removed from `mainRoot`), `archivalCommit` (the commit sha recording the active→archive transition), and, when the merged repo was devorch itself, `selfBuildInstalled` (the script auto-re-runs `install.ts` after a devorch self-merge). Done.
- `ok: false` → route by `phase`:
  - `"rebase"` → rebase conflict in a specific repo; surface `failedRepos[].conflictFiles` and instruct manual resolution.
  - `"dry-run"` → one or more repos' merge dry-run failed; list them with conflict files. No repo was merged (atomicity guard). Preserve all worktrees.
  - `"merge"` → a merge failed after dry-run passed (rare: concurrent writes to main); surface `okRepos[]` (already merged) and `failedRepos[]` (pending). Prompt user to resolve.
  - `"cleanup"` → merge succeeded but worktree/branch removal failed; surface for manual cleanup.

Plan archival is done inside `merge-worktree.ts`. Self-build install (when the merged repo's `package.json` has `"name": "devorch"`) is also handled inside the script — it re-runs `install.ts` from `mainRoot` so `~/.claude/{agents,commands,devorch-scripts,hooks}` reflect the merged state. Nothing extra to run.

On FAIL → do not merge, preserve worktrees, suggest `/devorch --resume` to retry or a fresh `/devorch "<fix description>"` for a new attempt.

## Step 14 — Gotcha capture

Apply the gotcha-capture rule (§ Gotcha capture below). Devorch's pipeline has the richest signal — builder retries, reviewer surprises, guardian flags on untyped contracts — so this step routinely produces real entries.

## Step 15 — Flow friction capture

Roda antes do report final. Captura atritos no próprio fluxo do devorch — não em código do usuário. Conta: script errou ou retornou JSON malformado, retry loop precisou >1 tentativa, gate precisou ser reinvocado, hook não disparou quando devia, você improvisou porque a instrução estava ambígua, bifurcação sem precedente nem resposta da indústria.

**Inbox path** (primeiro que casar): `$DEVORCH_REPO/.devorch/flow-issues-inbox/` → `../devorch/.devorch/flow-issues-inbox/` → `<mainRoot>/.devorch/flow-issues-inbox/`.

**Um arquivo por atrito**, nomeado `<YYYY-MM-DD>-<slug>.md`, contendo: título, timestamp, `Severity` (blocker/gap/nit), prompt pronto (`/devorch "<fix>"`), contexto mínimo (onde/o que aconteceu/esperado/workaround).

**Zero atritos**: não escreva nada e omita qualquer menção no report. **≥1 atrito**: adicione ao report `### Flow friction capture: N item(s) em <inbox-path>/`.

---

## Unified gate UX (used by Step 6)

**Precondition**: este gate só roda quando há pelo menos uma bifurcação real ou um heads-up crítico (`K + J > 0`). Se ambos forem zero, Step 6 já terá pulado este gate silenciosamente — não invoque `AskUserQuestion` apenas para confirmar defaults. Se só heads-ups existirem (`J > 0`, `K == 0`), rode apenas o heads-up pass; se só bifurcações existirem (`K > 0`, `J == 0`), rode apenas o bifurcations pass.

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

Zero questions é resultado válido — se `K == 0` e `J == 0`, Step 6 já pulou este gate inteiro.

## Gotcha capture

Gotchas are invariants the code does not self-document — non-obvious behaviors a fresh reader would discover only by hitting a bug. GOTCHAS.md grows organically: the orchestrator curates candidates during the run and, silently, writes those that clear the quality bar. No script bulk-generates entries; no `AskUserQuestion` gates the write. Each entry is earned by a real surprise observed in the current session, and the user's retroactive control is git (the commit is diffable; pruning happens on demand via `/devorch "review gotchas"`).

**When to accumulate candidates** (any of the following during the run):

- A builder needed a retry caused by undocumented behavior.
- A reviewer (security / performance / completeness / flags) explicitly marked a finding as "this surprised me" or "non-obvious".
- The guardian flagged an invariant not enforced by types/tests/linter.
- A type or interface did not describe real runtime state.
- Understanding a touched area required reading non-adjacent files for a non-obvious reason.

**Quality bar** — every accepted candidate must satisfy all four. If any fails, drop silently; do not soften the entry to make it fit.

1. **Concrete `file:line` reference** — a future reader can jump straight there. No "somewhere in module X".
2. **"Why it surprises" sentence** — one sentence a fresh Claude session would genuinely benefit from. If it reads generic ("the code does X", "remember to validate Y"), the candidate fails — that is self-documenting code or a platitude.
3. **Not covered by types, tests, linter, or obvious code reading** — if TypeScript, a test name, or a lint rule already encodes the invariant, it is not a gotcha. The gotcha lives in the gap between those.
4. **Would change a future session's behavior** — landing here, a future Claude would take a different action (retry avoided, bug not re-introduced, edge case not overlooked, non-obvious workaround preserved). Historical trivia and commit-log summaries fail this test.

Because there is no user gate, the bar must be applied strictly. When in doubt, drop it. A smaller GOTCHAS.md that is fully load-bearing beats a larger one diluted by marginal entries — dilution trains future Claudes to ignore the file.

**Dedupe before writing**: read the existing `GOTCHAS.md` (if any) and discard candidates whose title or `file:line` already appears. Never rewrite existing entries.

**Writing**: append surviving candidates to `<projectRoot>/.devorch/GOTCHAS.md` (create with `# Gotchas\n` header if missing). Shape per entry:

```
- **<short title>** (`file:line`) — <one-line why it surprises>.
```

Commit once per session (not per candidate), inside `<projectRoot>`:
- 1 entry → `chore(devorch): gotcha — <short title>`
- 2+ entries → `chore(devorch): gotchas — <N> entries`

**Report transparency**: when ≥1 entry was written, add a section to the final report so the user sees what landed without needing to diff:

```
### Gotchas adicionados: N em .devorch/GOTCHAS.md
- <short title> (`file:line`)
- ...
```

When zero entries were written, omit the section entirely — no "nenhum gotcha capturado" line.

**Prune on demand, not automatically**: staleness is not detected by script. `/devorch "review gotchas"` re-reads each entry against current code and proposes removals for ones that no longer apply.

## Worktree policy

- Worktree is **always** created in Step 2, before any explore or build.
- Naming: `.worktrees/<name>` where `<name>` is kebab-case (3–5 words derived from `$ARGUMENTS`).
- Branch: `devorch/<name>`.
- Merge: via `merge-worktree.ts` in Step 13 (rebase → check → review → `--no-ff` → cleanup).

## Rules

- **Explore claim re-verification**: when an Explore agent (Wave 1, Wave 2, or any later launch) reports a deterministic claim — counts, absences, or presences as fact ("zero importers", "no usages found", "no callers", "deprecated", "0 references", "only referenced by X") — the orchestrator MUST verify with a deterministic grep before quoting the claim to a builder, surfacing it in `<decisions>`, or using it to justify a Step 6 silence. Run the grep yourself (`git -C <projectRoot> grep -n <symbol>`, `grep -rn`, etc.) and compare. If the grep contradicts the Explore claim, prefer the grep result and surface the discrepancy as a one-line note in the affected slice (e.g. `Note: Explore reported 0 importers; grep encontrou 2 em foo.ts:12, bar.ts:34`). Do not propagate uncertain claims as certainties — Explore is a hypothesis generator, grep is the oracle.
- Do not narrate actions. Execute directly without preamble.
- The orchestrator reads `.devorch/*` files and Explore/review agent output; it does not read source files directly except for applying trivial fixes in Step 11.
- All `git` and `bun` commands during phase execution run with `cwd = <projectRoot>` (or `git -C <projectRoot>`).
- Silence is valid in the guardian pass — do not fabricate heads-ups.
- Post-edit lint hook is always active (registered on the builder agent).
- **Language policy**: User-facing output (questions, reports, summaries) in Portuguese pt-BR with correct accentuation. Code, git commits, internal files, and technical comments in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese sentences.
- **Output format**: Plain markdown only. No box-drawing, no ASCII art, no decorative characters.
- Coexists with legacy `/devorch:talk|build|fix` (v2) — those existing commands continue to work for projects mid-flight on v2 plans.
