---
description: "Plan-driven build with DAG-parallel phases + adversarial review"
argument-hint: "[--resume] <what to do>"
model: opus
effort: xhigh
disallowed-tools: EnterPlanMode
---

Single-mode entry point for devorch. Use it whenever you need orchestration of medium-to-large work — for trivial edits (single-file typo, rename in a known location), use vanilla Claude Code; devorch's ceremony does not pay off there.

Pipeline has 6 stages: worktree setup → discovery → plan → build (DAG scheduler) → quality gates → merge + save flags. **Every devorch session runs inside a fresh `git worktree`** so your WIP on the current branch is never disturbed and any session can be discarded by deleting the worktree. The orchestrator merges back into your original branch at the end with smart conflict resolution.

**Input**: `$ARGUMENTS` — description plus optional flag:
- `--resume` — resume an in-progress session (auto-finds the active worktree; no description needed)

After stripping `--resume`, if the remaining `$ARGUMENTS` is empty and `--resume` is not set, stop and ask the user.

## Stage 0 — Resume short-circuit

If `--resume` is present:
1. Run `bun $CLAUDE_HOME/devorch-scripts/list-active-plans.ts`. Parse JSON `{count, plans: [{worktree, planPath, planTitle, donePhases, totalPhases}]}`.
2. If `count == 0` → report "Nenhum plano em progresso para retomar." and stop.
3. If `count == 1` → resume that worktree directly. If `count > 1` → `AskUserQuestion` listing each `<planTitle>` (worktree `<worktree>`, `<donePhases>/<totalPhases>` phases done) and pick one.
4. Bind: `mainRoot = <cwd>`, `worktreePath = <mainRoot>/.worktrees/<chosen.worktree>`, `planPath = <chosen.planPath>`. Read `originalBranch` from `<worktreePath>/.devorch/cache/origin-branch.txt` (written by `setup-worktree.ts` at session start). If missing, fall back to `git -C <mainRoot> symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null` stripped of `origin/`, then `main`, then `master`.
5. All subsequent operations use `<worktreePath>` as the working directory. If `<worktreePath>/.devorch/cache/explore.json` exists (persisted at end of Stage 1), parse it and treat its `findings` as the resume-mode explore context for builder prompts. Skip Stages 1 and 2; jump to Stage 3 (build scheduler), which reads the plan and resumes from the first non-done phase.

Note: even when `explore.json` is absent (older worktrees), the scheduler proceeds with plan + gotchas. If a remaining phase needs broader context, it may launch a fresh Explore agent inline before dispatching that phase.

## Stage 0.5 — Worktree setup (always, unless resuming)

If Stage 0 did NOT short-circuit, every fresh `/devorch` invocation creates a worktree before any other work via `setup-worktree.ts`:

1. Derive `<name>` (kebab-case, 3–5 words) from `$ARGUMENTS`. Reused as the plan filename in Stage 2.
2. Record `mainRoot = <cwd>`.
3. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name>`. Parse JSON `{worktreePath, branchName, originalBranch, uncommittedFilesCount, gotchasCopied, suffixed}`. The script handles atomically: collision suffixing if `.worktrees/<name>` or branch `devorch/<name>` already exist, `git worktree add` on a new branch, persisting `originalBranch` to `<worktreePath>/.devorch/cache/origin-branch.txt`, and copying `GOTCHAS.md` forward.
4. If `uncommittedFilesCount > 0`, surface a one-line note: `WIP no branch original: <N> arquivo(s) — preservados em <mainRoot>, não entram no worktree.` The user's WIP stays untouched on the original branch.
5. If `suffixed` is true, log: `Nome <baseName> em uso, usando <worktreePath>.`
6. From here forward, every Bash/git/script invocation uses `<worktreePath>` as the working directory (or `git -C <worktreePath>`). Builders receive `Working directory: <worktreePath>` in their prompts.

## Stage 1 — Discovery (parallel)

Stage 1 runs in two phases: **1a discover (sequential, ~1-2s)** then **1b Explore agents (parallel, with discover output in their prompts)**. The serial cost is tiny vs. the relevance gain — Explore agents that know the project layout, gotchas, and profile produce dramatically more focused findings.

### 1a — Discover (sequential)

Run `bun $CLAUDE_HOME/devorch-scripts/discover.ts <worktreePath>`. Always exits 0. Parse JSON `{projectMap, siblingRepos, gotchas, gotchasLegacy, profile: {raw, source}, silencedStandards, warnings}`. The script:
- Writes `<worktreePath>/.devorch/cache/project-map.md` (3-level tree, scripts, Makefile)
- Returns the same map as a string, plus structured `siblingRepos: [{name, relativePath, branch}]`
- Resolves profile precedence (per-project → user-home → defaults from `docs/PROFILE.md`)
- Loads gotchas (with legacy `CONVENTIONS.md` fallback) and silenced-standards
- Handles missing files as empty strings; never SIGPIPE-cancels parallel work

Keep `profile.raw` as `<profile>` for the guardian role; consult `silencedStandards` before emitting heads-ups.

### 1b — Explore agents (parallel, informed by discover)

Launch 1–3 Explore agents (`subagent_type="Explore"`) in a single message. **Each prompt MUST include**:

- `Working directory: <worktreePath>` so the agent searches inside the worktree, not mainRoot.
- A scoped slice of `projectMap` showing the directories likely relevant to `$ARGUMENTS` (don't paste the whole map; pick the top-level directories that match the request).
- Filtered gotchas: entries from `gotchas` whose `file:line` falls under the relevant directories. This lets the agent skip re-discovering known traps.
- Profile priorities as a one-liner: e.g. `Priorities (rank findings accordingly): security > performance > dx > cost`.
- Sibling repos hint when relevant: if the request implies cross-repo work and `siblingRepos` is non-empty, include the sibling list and ask the agent to surface cross-repo concerns.

Focus selection (orchestrator judgment):
- Always: 1 agent on architecture + existing patterns in the touched area, thoroughness `medium` if gotchas already cover known traps, `very thorough` otherwise.
- When the request spans 2+ modules or has multi-feature scope: 1 additional agent on risks/edge surfaces, `very thorough`.
- When the request references a specific contract/spec/behavior: 1 additional agent dedicated to locating and reading it deeply, `very thorough`.

Hard cap: 3 Explore agents per session. If you reach the cap and still feel under-informed, the request is malformed — surface that to the user.

### 1c — Persist findings for `--resume`

After all Explore agents return, **write** consolidated findings to `<worktreePath>/.devorch/cache/explore.json` via the Write tool:

```json
{
  "createdAt": "<ISO timestamp>",
  "arguments": "<$ARGUMENTS>",
  "findings": [
    { "agent": "architecture", "thoroughness": "medium", "summary": "..." },
    { "agent": "risks", "thoroughness": "very thorough", "summary": "..." }
  ]
}
```

Each `summary` is the orchestrator-curated 1-3 paragraph version (NOT the full agent output — that's already in your context). On `--resume`, Stage 0 reads this file so future builders inherit the discovery context without relaunching Explore.

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

**Mechanical validation (script)**: run `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <planPath>`. Returns JSON `{ok, errors, warnings}`. Errors cover:
- Required blocks (`<description>`, `<objective>`, `<classification>`, `<decisions>`) and `# Plan: <name>` header
- Phase IDs unique; `<depends-on>` references only existing IDs; DAG is acyclic
- Every task has `**ID**` and `**Files**`
- File disjunction within a phase
- File disjunction across pairs of phases that can run concurrently (no dep chain in either direction)

If `ok: false`, redraft the plan addressing each error and re-run the validator until clean.

**Implicit-touch sweep (judgment, inline)**: validator covers declared files; orchestrator must still infer non-declared touches. Read each task and consider files likely modified that aren't in `**Files**`:
- Barrel files / index aggregators (`src/index.ts`, `mod.ts`) when adding/renaming exports
- Hook registries when adding a new hook
- Plugin / command / route registries when adding new entries
- Type re-exports (`types.ts`, `index.d.ts`) when adding a new exported type
- Generated migration filenames (DB schemas)

Grep the worktree to confirm each candidate exists. If verified, add it to the task's `**Files**` line and re-run `validate-plan.ts` (the augmented disjunction check might now flag a real overlap that needs redraft). Once all checks pass, commit the plan: `git add .devorch/plans/<name>.md` (and `.devorch/GOTCHAS.md` if updated) → `git commit -m "chore(devorch): plan — <name>"`.

**Active plan commit is best-effort**: if `git add` fails because `.devorch/plans/` is gitignored (some projects keep active plans untracked and only commit `archive/` via convention), skip the commit silently — do NOT use `-f`. The active plan is a transient artifact; the durable record is the Stage 5 archive (which uses `git add -f` defensively, since archived plans are convention-tracked even when `.devorch/` is otherwise ignored). The working tree retains the active plan regardless, so builders can still read it. If `.devorch/GOTCHAS.md` was updated and is tracked, commit it standalone with `git commit -m "chore(devorch): gotchas update"`.

Set `planPath = .devorch/plans/<name>.md`.

## Stage 3 — Build (DAG scheduler)

Loop until every phase in the plan is marked `status="done"`:

1. **Compute ready set via script**: run `bun $CLAUDE_HOME/devorch-scripts/dag-scheduler.ts --plan <planPath> [--running id1,id2]`. Pass the IDs of phases currently in flight (none on first iteration). Returns JSON `{ready, blocked, done, running, totalPhases}`. Cycle detection and file-overlap checks happen mechanically — no inline reasoning needed.
2. If `ready` is empty AND `running` is empty → all `done`, exit loop. If `ready` is empty AND `running` is non-empty → wait for currently-running phases to finish, then recompute.
3. **Dispatch every ready phase in parallel** in a single assistant message:
   - For each phase ID in `ready`, launch all its tasks via the Task tool with `subagent_type="devorch-builder"`. One Task tool call per task. All Task calls go in the same assistant message so they run in parallel.
4. **Wait for the wave to complete.** When all dispatched tasks return:
   - For each task, verify completion via `git -C <worktreePath> log --oneline` (a commit matching the task ID/title appears).
   - For each phase whose tasks all committed successfully, mark it `status="done"` in the plan file (in-place edit: `<phase id="X" name="Y">` → `<phase id="X" name="Y" status="done">`).
5. Recompute the ready set via the script and loop.

### Builder prompt assembly (per task)

For each task in the ready phase, run `bun $CLAUDE_HOME/devorch-scripts/assemble-task-prompt.ts --plan <planPath> --task-id <taskId> --worktree <worktreePath>` and parse JSON `{ok, prompt, files, specRefs, phaseId, warnings}`. The script extracts the task block from the plan, resolves Spec refs against the phase's `<spec>` block, and filters `.devorch/GOTCHAS.md` to entries that touch files in `**Files**`. The orchestrator only adds the dynamic outer wrapping:

1. **Working directory** — prepend `Working directory: <worktreePath>` (the devorch worktree). All builder git operations use `git -C <worktreePath>`; commits land on branch `devorch/<name>`.
2. **Plan context** — prepend Plan title + `<objective>` + `<solution-approach>` (if present) + `<decisions>` (one-time read of plan; cache for subsequent tasks in same dispatch).
3. **Script output** — inline the `prompt` field from the script (Task + Spec Contracts + Gotchas already filtered and formatted).
4. **Explore findings** — orchestrator-curated subset of Stage 1 (or `explore.json` on resume) relevant to this task. Omit the section entirely if no findings apply.
5. **Exemplars** — if the task block lists Exemplars, suggest the builder Read those files for stylistic mirroring.

Send all task prompts in a single assistant message (one Task call per task). Builder retries on failure: up to 3 attempts per task. Each retry appends a `## Previous Failure Context` section: retry count, last 50 lines of prior output, `git diff` from the failed attempt (or "no commits"), instruction to diagnose root cause. On retry exhaustion: stop the build, emit a structured failure report, suggest a fresh `/devorch` invocation for re-planning.

**On agent resolution failure** (Task tool returns `Agent type not found`): the builder agent isn't registered in the current session — typically because it was installed after session start. Surface the registration issue and suggest restarting Claude Code after `bun install.ts`.

### Inline Explore on resume

On the resume path, the original Stage 1 findings are gone. If a phase about to dispatch needs broader context (the orchestrator judges based on the gap between gotchas and what the task implies), launch a single Explore agent inline before assembling that phase's builder prompts. Use the same scoping rules as Stage 1 but with the phase's specific scope — not the whole request.

## Stage 4 — Quality gates (parallel)

After the DAG completes, run all of the following in parallel in a single assistant message:

1. **`check-project`** — `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <worktreePath>` (full: lint + typecheck + build + tests). Parse JSON.
2. **Adversarial reviewers** — 4 Explore agents (`subagent_type="Explore"`, foreground), each receiving: `Working directory: <worktreePath>`, plan objective, GOTCHAS.md (if present), changed-files list (`git -C <worktreePath> diff --name-only <originalBranch>...HEAD`).
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
- **Trivial** (1–2 files, obvious fix) → batch ALL trivial findings into a SINGLE `devorch-builder` agent prompt with bullet-points. Do NOT use inline Edit — that pollutes the orchestrator context with file contents that aren't needed for downstream stages. The builder handles all trivial fixes in isolated context and returns a clean Build Report.
- **Fix-level** (well-defined, 3+ files or non-trivial) → launch one `devorch-builder` per finding in parallel (respecting non-overlap with other fix-level findings AND the trivial batch's files).
- **Talk-level** (needs design) → do not fix; leave as a pending item plus a suggested fresh `/devorch` prompt.

Dispatch shape: in a single assistant message, launch the trivial-batch builder (if any) plus all non-overlapping fix-level builders in parallel. Sequence overlapping fix-level findings into subsequent dispatches.

Skip this stage entirely if every reviewer + residual scan reported zero findings. After fixes, re-run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <worktreePath>` (full if any fix-level launched, append `--quick` if trivial-only). One retry on failure.

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

### Archive plan (inside the worktree)

If verdict is PASS (or PASS with non-blocking pendencies):
- `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan <planPath>` — moves plan to `<worktreePath>/.devorch/plans/archive/<date>-<name>.md` AND stages it for commit (`git add -f` on the archive path, `git add -u` on the active path to capture deletion if it was tracked). The script's JSON output includes `staged: true|false`.
- Also archive the flags file alongside if present: `git -C <worktreePath> mv -f .devorch/flags-<name>.md .devorch/plans/archive/flags-<date>-<name>.md` (or copy + delete + `git add -f` if `git mv` rejects gitignored sources).
- Commit inside the worktree: `git -C <worktreePath> commit -m "chore(devorch): archive plan — <name>"`.

On FAIL → keep the plan active so `--resume` can pick up where the failure left off. Suggest the user inspect, then `/devorch --resume` after fixing manually, or a fresh `/devorch "<fix description>"`. The worktree stays put.

### Merge into the original branch

After the archive commit lands inside the worktree, fold the work back into `<originalBranch>` on `<mainRoot>` via `merge-and-cleanup.ts`:

```
bun $CLAUDE_HOME/devorch-scripts/merge-and-cleanup.ts \
  --worktree <worktreePath> \
  --branch devorch/<name> \
  --target <originalBranch> \
  --plan-title "<Plan Title>"
```

The script runs atomically: fetch origin (best-effort), rebase worktree onto `origin/<target>` (or just `<target>` if no remote), quick check-project sanity, dry-run merge into mainRoot, real merge `--no-ff`, then cleanup (worktree remove + branch delete). Plan title comes from the plan file's `# Plan: <Title>` header — pass it verbatim.

**Output JSON** (`{ok, phase, ...}`) — route by `phase`:

- `ok: true, phase: "cleanup"` → done, log a one-line success summary.
- `ok: false, phase: "rebase"` → conflicts during rebase. The script returns `conflictFiles: [...]`. Apply the **Conflict resolution rule** below to each file, then re-run with `--phase merge` (script picks up where it left off — skipping rebase but doing dry-run + merge + cleanup).
- `ok: false, phase: "sanity-check"` → check-project reported lint/type/build failures after rebase. Surface the `check` payload to the user; do NOT continue automatically. After manual fix, re-run with `--phase merge`.
- `ok: false, phase: "merge"` → conflicts during the merge into mainRoot. The script aborted the partial merge for you (clean state in mainRoot). Apply the **Conflict resolution rule**, manually `git -C <mainRoot> commit -m "merge(devorch): <Plan Title>"`, then re-run with `--phase cleanup` to remove the worktree + delete the branch.

The script never loops on conflicts — semantic resolution is the orchestrator's job. The script's role is mechanical: atomic rebase/merge/cleanup with structured error reporting.

#### Conflict resolution rule

Both `git rebase` and `git merge --no-ff` may produce conflicts when the original branch advanced while the worktree was building. **Resolve every conflict by reading and judging — never blindly take one side.**

For each conflicted file:

1. Read the file. The standard conflict markers are present (`<<<<<<<`, `=======`, `>>>>>>>`).
2. Identify the **intent of each side**:
   - `<<<<<<< HEAD` (our side during merge — the original branch's recent change; or during rebase, the upstream side).
   - `>>>>>>> devorch/<name>` (their side — the worktree's change; or during rebase, your in-progress commit).
3. Apply the **keep-both-when-valid principle**: if both sides represent legitimate, non-contradictory changes (e.g. the original branch fixed a bug in function A while the worktree added function B in the same file), the resolved file MUST contain both changes. The conflict only existed because git couldn't 3-way-merge line-adjacent edits — semantically there's no real conflict.
4. Cases:
   - **Both sides valid, additive** → keep both (interleave functions, merge import lists, concatenate test cases). Most common case.
   - **Both sides valid, refactoring same surface differently** → synthesize a version that preserves the intent of both (e.g., the original renamed `fooBar` → `foo_bar` while the worktree added a new param: rename AND add the param).
   - **Truly contradictory** (e.g., one side deletes the function, other side modifies it) → `AskUserQuestion` with the two options + a third "keep mine + their delete elsewhere" if it makes sense. Do not guess.
   - **Worktree changes are now redundant** (the original branch already added what the worktree intended) → take HEAD, drop worktree's lines, log it.
5. After resolving each file, `git add <file>`. When all conflicted files are resolved, continue the operation: `git rebase --continue` (during rebase) or `git -C <mainRoot> commit` (after merge). Verify there are no further conflicts before moving on.

This conflict reasoning is the orchestrator's judgment, applied per file with `Read` + `Edit`. Don't delegate to a script — semantic resolution is exactly the kind of work where Opus pays off (Principle 3).

After cleanup, the merge commit on `<originalBranch>` of `<mainRoot>` is the durable record. The worktree is gone; the `devorch/<name>` branch is gone. Working directory for any further conversation reverts to `<mainRoot>`.

### Gotcha capture

Apply the gotcha-capture rule (§ Gotcha capture below).

### Flow friction capture

Roda antes do report final. Captura atritos no próprio fluxo do devorch — não em código do usuário. Conta: script errou ou retornou JSON malformado, retry loop precisou >1 tentativa, gate precisou ser reinvocado, hook não disparou quando devia, você improvisou porque a instrução estava ambígua, bifurcação sem precedente nem resposta da indústria.

**Inbox path** (primeiro que casar): `$DEVORCH_REPO/.devorch/flow-issues-inbox/` → `../devorch/.devorch/flow-issues-inbox/` → `<mainRoot>/.devorch/flow-issues-inbox/`. **Important**: write to `<mainRoot>`, never to `<worktreePath>` — the worktree gets removed at the end of the merge step, so anything written there is lost.

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

**Writing**: append surviving candidates to `<worktreePath>/.devorch/GOTCHAS.md` (create with `# Gotchas\n` header if missing). The merge step in Stage 5 brings the file back to mainRoot. Shape per entry:

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
