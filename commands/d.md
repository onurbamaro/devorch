---
description: "Unified entry — triage, guardian, build (quick/scoped/full)"
argument-hint: "[--quick|--full|--resume|--worktree] <what to do>"
model: opus
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
   - `cacheName = <name>`
   - `planPath` = the first `.md` under `<projectRoot>/.devorch/plans/` (excluding `archive/`)
   - `originalBranch` = run `git -C <mainRoot> symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo main` and strip `origin/` prefix; fall back to `main` or `master` as available.
5. Jump to full-mode Step F3 (phase loop) with these bindings.

## Step 1 — Load minimal context

Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts --compact` to collect tech stack and folder structure inline. Read `.devorch/CONVENTIONS.md` if it exists. Read `.devorch/profile.yml` (per-project first, then `~/.devorch/profile.yml`) and keep its content as `<profile>` for the guardian prompt. If neither exists, use the implicit defaults documented in `docs/PROFILE.md` § Defaults when absent (`priorities: [security, performance, dx, cost]`, no biases).

Also clean up stale cache: `find .devorch -maxdepth 1 -name 'explore-cache-*.md' -mtime +7 -delete 2>/dev/null || true`.

## Step 2 — Triage (Opus inline, short thinking)

Use short internal thinking (~500–1000 tokens) to classify `$ARGUMENTS` into exactly one mode:

- **quick** — 1–3 known files, explicit action, no design ambiguity. Signals: typo, rename, localized bugfix, config tweak, edit in a clearly identified file.
- **scoped** — 1 module, feature/fix with legitimate options, 1 explore suffices. Signals: bug with multiple possible causes, new endpoint in existing module, small feature, refactor in 1 file.
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
> Domain checklist (mnemonic): auth · rate-limiting · input validation · error boundaries · caching · indexing · N+1 · pagination · realtime strategy · upload path · async/queue · observability · idempotency · secrets handling · cross-tenant isolation.
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

Apply the edit directly with Edit/Write tools. Minimal changes. Follow CONVENTIONS.md strictly.

### Q3. Post-edit lint

The post-edit lint hook fires automatically via `PostToolUse`. If it surfaces errors, fix them inline.

### Q4. Commit

Conventional commit, stage only touched files:
```
git add <files>
git commit -m "type(scope): description"
```

### Q5. Report

One-line report: what changed, commit hash. Run the flow-friction capture (§ F9) — typically nothing to log for a clean quick edit. Stop.

---

## SCOPED mode (Steps S1–S8)

1 module, small feature or fix with options. No worktree unless `--worktree` flag.

### S1. Quick explore

Derive a kebab-case `<name>` from `$ARGUMENTS` (3–5 words). Launch 1 Explore agent (`subagent_type="Explore"`, thoroughness **medium**) in parallel with the rest of this flow. Focus: architecture, relevant files, existing patterns for the request. Wait for return before Step S2.

### S2. Enumerate edge cases (3 buckets)

Based on `$ARGUMENTS`, explore findings, CONVENTIONS.md, and the guardian pass, enumerate edge cases into 3 buckets:
- **Resolved by convention/code/request** — count only
- **Critical heads-up** (guardian) — show with redirect
- **Real bifurcation** — show with A/B/... options and a recommendation

### S3. Transparency block + unified gate

Emit this block to the user (plain markdown — no box-drawing):

```
Edge cases considerados: N
Resolvidos por convenção/código/pedido: M
Bifurcações reais: K
Heads up crítico: J

Heads up:
- <item> ... [opção A] [opção B] [skip]

Bifurcações:
1. <título>
   A) <opção> (recomendada)
   B) <opção>
   Recomendação: A — <1 linha de motivo>
2. ...

Quais itens clarificar? [Nenhum / Todos / Números (ex: 1,3)]
```

Then call `AskUserQuestion` once consolidating the gate. Options:
- **Nenhum** — seguir com defaults e recomendações
- **Todos** — abrir pergunta por cada bifurcação
- **Números** — usuário digita `1,3` para clarificar apenas esses

If the user chose **Números** or **Todos**, follow up with targeted `AskUserQuestion` rounds (max 4 questions per call) until all selected bifurcations are resolved. Zero questions is valid.

### S4. Worktree (opt-in)

If `--worktree` flag is present:
1. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name>` and parse JSON.
2. Set `projectRoot = <worktreePath>`. Copy CONVENTIONS.md into it.
3. All subsequent edits/commits run with `cwd` = `projectRoot`.

Otherwise `projectRoot = <cwd>`.

### S5. Execute

Apply edits directly with Edit/Write tools in `<projectRoot>`. Follow decisions from the gate. Minimal changes. Post-edit lint hook fires automatically.

### S6. Check

Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`. On failure, fix once; if still failing, report and stop.

### S7. Commit

Conventional commit in `<projectRoot>`, stage only touched files.

### S8. Report

Concise summary: edge cases count, bifurcations resolved, files changed, check result. Run the flow-friction capture (§ F9). Stop.

---

## FULL mode (Steps F1–F8)

Multi-module, new feature, or broad refactor. Worktree is mandatory.

### F1. Worktree + plan scaffold

1. Derive `<name>` (kebab-case, 3–5 words) from `$ARGUMENTS`.
2. Record `mainRoot = <cwd>` and `originalBranch = git branch --show-current`.
3. If CONVENTIONS.md missing, run `bun $CLAUDE_HOME/devorch-scripts/map-conventions.ts <mainRoot>` and write `.devorch/CONVENTIONS.md`, then `bun $CLAUDE_HOME/devorch-scripts/check-conventions-staleness.ts --update`. If present, run `bun $CLAUDE_HOME/devorch-scripts/check-conventions-staleness.ts`; if stale → regenerate via `map-conventions.ts` then `--update`.
4. Run `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <name>` and parse JSON. Store `worktreePath`, set `projectRoot = worktreePath`.
5. Copy CONVENTIONS.md to `<projectRoot>/.devorch/CONVENTIONS.md`.

### F2. Deep explore + guardian + gate

1. Launch 2–3 Explore agents (`subagent_type="Explore"`, thoroughness **very thorough**) in parallel with distinct focuses (architecture, risks/edges, existing patterns). Write combined findings to `<mainRoot>/.devorch/explore-cache-<name>.md`.
2. Re-run the guardian pass with full exploration context. Enumerate edge cases into the same 3 buckets as scoped mode.
3. Emit the same transparency block (Step S3) and a single `AskUserQuestion` gate with `Nenhum / Todos / Números`. Resolve bifurcations in follow-up rounds if needed.
4. Draft the plan following the Plan Format specified in `commands/talk.md` (description, objective, classification, decisions, problem-statement, solution-approach, relevant-files, phases with `<spec>`, `<tasks>`, `<execution>`, `<criteria>`, `<handoff>`). Write it to `<projectRoot>/.devorch/plans/<name>.md`.
5. Run `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <projectRoot>/.devorch/plans/<name>.md`. Fix issues if blocked.
6. Commit the plan in the worktree: `git -C <projectRoot> add .devorch/plans/<name>.md .devorch/CONVENTIONS.md && git -C <projectRoot> commit -m "chore(devorch): plan — <name>"`. Also commit explore-cache changes in `<mainRoot>` with `chore(devorch): add worktree for <name>`.
7. Set `planPath = <projectRoot>/.devorch/plans/<name>.md`.

### F3. Phase loop

For each phase N sequentially:

#### F3a. Init phase
Run `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan <planPath> --phase N --cache-root <mainRoot> --cache-name <name>`. Parse JSON. If `contentFile` is present, read it for full context.

#### F3b. Filter size gate
Read `sliceWarnings` from the init-phase JSON output (authoritative thresholds: <3K = `under`, >30K = `over`). If the array is non-empty, pause and show the user: task id, direction, approximate token count. Offer: continue / split the task / re-curate the slice (manually edit cache or conventions scope). Do not dispatch builders until the array is empty or the user explicitly accepts the warnings.

#### F3c. Dispatch builders (parallel waves)
For each wave from the init-phase output, launch all `taskIds` in a single message via the Task tool with `subagent_type="devorch-builder-deep"`. Each builder prompt includes: `Working directory: <projectRoot>`, Plan Objective + Solution Approach + Decisions, full task details, `## Conventions` (filtered by `conventionSectionsByTask[taskId]`), `## Code Structure` (if non-empty), `## Exemplars` (if non-empty), `## Spec Contracts` (if non-empty), `## Non-goals` (if non-empty), cache sections. Order: Conventions → Code Structure → Exemplars → Spec Contracts → Non-goals → cache.

After each wave returns: verify task completion, extract `## Build Report` blocks keyed by task-id, `TaskUpdate` completed tasks. On builder failure → per-task retry (max 3) with error context; on 3 retries exhausted → stop the phase and report structured failure (same template as `commands/build.md` § 2c).

#### F3d. Per-phase check
If `totalPhases > 1`: run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot> --quick`. Fix all errors or report and stop.

#### F3e. Phase summary + commit + cache trim
- `bun $CLAUDE_HOME/devorch-scripts/phase-summary.ts --plan <planPath> --phase N --status "ready for phase $((N+1))" --summary "<concise>"`
- Commit with the returned message if there are changes.
- `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000 --root <mainRoot> --cache-name <name>`

### F4. Categorized adversarial review

After all phases complete, determine changed files via `git -C <projectRoot> diff --name-only <originalBranch>...HEAD`. Grep for `TODO|FIXME|HACK|XXX` across changed files (residual scan).

Launch 4 reviewers in parallel (`subagent_type="Explore"`, foreground, single message). All receive: `Working directory: <projectRoot>`, plan objective, CONVENTIONS.md, changed-files list.

- **security** — OWASP Top 10 anti-patterns, injection risks, auth gaps, data exposure, secrets handling
- **performance** — estimated cost, anti-patterns (N+1, full scans, polling, synchronous workers, server-side buffering), cache opportunities
- **completeness** — spec vs delivery: every `<spec>` element satisfied? cross-phase integration intact? handoffs honored?
- **flags** — adjacent items out of scope. For each flag: type (security | performance | architecture | ops), severity, detection (file:line), suggested fix, one-line alternative. Write all flags to `<mainRoot>/.devorch/flags-<name>.md` using the FLAGS.md format.

### F5. Apply review fixes

Classify each finding:
- **Trivial** (1–2 files, obvious fix) → apply inline with Edit.
- **Fix-level** (well-defined, 3+ files or non-trivial) → launch `devorch-builder-deep` agents in parallel.
- **Talk-level** (needs design) → do not fix; leave as a pending item plus a suggested `/d --full` prompt.

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
<talk-level items com prompt /d --full sugerido ou "Nenhum">

### Verdict: PASS / PASS com N pendências / FAIL
```

### F7. Merge flow

If verdict is PASS (or PASS with pendencies that are non-blocking), run the v3 merge-worktree script from `<mainRoot>`:

```
bun $CLAUDE_HOME/devorch-scripts/merge-worktree.ts --worktree <name>
```

Optional flags: `--squash` (orchestrator must commit manually after), `--keep-branch`, `--no-rebase`, `--dry-run`. The script auto-detects main branch, rebases the worktree onto `origin/<mainBranch>`, runs `check-project --quick`, merges with `--no-ff` by default, archives the plan, removes the worktree, and deletes the branch. All in one call.

Parse JSON output and route by `ok`:
- `ok: true` → report `merged` (merge commit sha), `commitsIntegrated`, `filesChanged`, `planArchivedTo`. Done.
- `ok: false` with conflict details → surface the conflicting files; worktree is preserved. Suggest manual resolution or `/d --resume`.

**Multi-repo limitation**: `/d --full` does not orchestrate satellite-repo merges in this iteration. If the plan declared `<secondary-repos>`, the v3 merge-worktree script handles only the primary. Use `/devorch:worktrees` (v2 command) for the coordinated multi-repo merge flow.

Plan archival is done inside `merge-worktree.ts`. Self-build install (when the project is devorch itself) is also handled inside the script. Nothing extra to run.

On FAIL → do not merge, preserve worktree, suggest `/d --resume` to retry or `/d --full "<fix description>"` for a new attempt.

### F8. Feedback (user preferences)

If `<mainRoot>/.devorch/feedback.md` gained entries in this session, append:
```
### Feedback devorch
N dificuldades registradas. Para evoluir:
/d --full Evoluir o devorch baseado em .devorch/feedback.md
```

### F9. Flow friction capture (all modes — not just full)

This step runs in **every mode** (quick / scoped / full) right before the final report. It captures frictions in the devorch flow itself — not in user code. Examples of what counts:

- Script errored, returned malformed JSON, or was missing a field d.md expected
- A retry loop needed more than 1 attempt to recover
- `AskUserQuestion` had to be re-invoked because the first gate didn't cover a case
- A hook didn't fire when d.md said it should
- You (the orchestrator) had to improvise a step because d.md was ambiguous
- A bifurcation had no precedent and no industry answer — clear gap

For each friction observed this session, write one file to the inbox directory:

**Inbox path resolution**:
1. If env `DEVORCH_REPO` is set and `<DEVORCH_REPO>/.devorch/flow-issues-inbox/` exists → use it.
2. Else if a sibling devorch repo exists at `../devorch/.devorch/flow-issues-inbox/` → use it.
3. Else → `<mainRoot>/.devorch/flow-issues-inbox/` (project-local, user will copy later).

**File naming**: `<YYYY-MM-DD>-<slug>.md` (slug is 3-5 words from the friction title).

**File format**:
```markdown
# Flow issue: <title>

**Captured**: <ISO timestamp>
**Origin session**: /d <original $ARGUMENTS>
**Mode**: quick | scoped | full
**Severity**: blocker | gap | nit

## Ready-to-paste prompt

/d <--quick|--full|nothing> "<concrete fix description>"

## Context

- Where: <file>:<section> (e.g. commands/d.md § F3b)
- What happened: <1-2 lines>
- Expected: <1 line>
- Workaround used: <if any>

## Related

- <link to docs/V3-TEST-PLAN.md issue if applicable, or "new">
```

**If zero frictions were observed**, write nothing and output one line: "Flow friction capture: nenhum item registrado." Do not create empty files.

**If one or more frictions were captured**, output a summary at the end of the report:
```
### Flow friction capture
N item(s) registrado(s) em <inbox-path>/.
Copie os prompts para /d quando for evoluir o devorch.
```

Keep entries surgical — one friction per file, each readable standalone. The inbox accumulates over time; periodic sweep from the devorch repo clears backlog.

---

## Step 5 — Unified gate UX (used by scoped and full)

The transparency block above is always followed by a single `AskUserQuestion` call with these options:

- **"Nenhum"** — seguir com defaults e recomendações
- **"Todos"** — abrir pergunta para cada bifurcação em rounds subsequentes
- **"Números: 1,3,..."** — clarificar apenas os itens listados (usuário digita a lista)

If **Números** or **Todos** is selected, loop with `AskUserQuestion` (max 4 per call) until all selected bifurcations are resolved. Zero questions is a valid outcome.

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
