# devorch Philosophy

> This document captures the core principles behind devorch.
> Use it as a litmus test when evaluating new Claude Code features:
> if a native feature honors these principles, adopt it.
> If it violates them, keep the devorch approach.

Nine principles, each paired with a validation question that tells you
when you are violating it. The principles are descriptive of what the
current implementation commits to; if the code drifts from a principle,
one of the two is wrong and needs explicit reconciliation.

---

## Principle 1: Orchestrator stays focused, not small

The orchestrator's context window is not sacred because it is small --
it is sacred because it is the dispatch surface. With a 1M token window,
coordination logic, script outputs, classification, and validation can
live inline. What must not live there is implementation detail: source
files being edited, debug traces, builder retries, raw exploration dumps.

**Why this matters:** LLM attention is not uniform across long contexts.
The "lost in the middle" effect is well documented -- models recall
recent and opening tokens far better than material buried in the middle
third. A focused orchestrator with 40K of coordination state outperforms
a diluted orchestrator with 400K of mixed coordination and implementation
noise. The 1M window removes the excuse for ceremonial delegation, not
the cost of contextual dilution.

**How devorch enforces this:**
- Guardian role and edge-case enumeration happen inline in the orchestrator (Opus, short thinking)
- Scripts return structured JSON; raw file content does not enter the orchestrator
- Builder agents run in isolated contexts destroyed after each task
- Explorer agents return summaries, not inlined source
- Orchestrator-curated slices keep builders out of unrelated detail

**Validation question:** _"Is this content helping the orchestrator decide
and dispatch, or is it implementation detail that belongs in a builder?"_
If the latter, it does not belong in the orchestrator.

---

## Principle 2: Fresh context per subagent, with curated slices

A builder working on task 15 should have the same quality of context as
the builder working on task 1. Every subagent -- builder, explorer,
reviewer -- starts from a curated, isolated slice. Curation is the
orchestrator's job: it selects from explore findings, gotchas, and the
plan only what each task needs.

**Why this matters:** Context compaction is lossy by definition, and
accumulated context is the primary vector for quality decay across long
sessions. Critical conventions discussed at token 5K are statistically
less reliable at token 300K. A fresh slice avoids the decay entirely.

**How devorch enforces this:**
- Each builder receives plan task + relevant gotchas + filtered explore findings + exemplars
- Typical builder context: 5-10K tokens
- Orchestrator curates per-task subsets inline (no init-phase script ceremony)
- Builders never see other builders' work, errors, or intermediate states
- Reviewers receive only changed files + plan objective + gotchas — no build chatter

**Validation question:** _"Does every subagent start from a slice I would
be willing to paste into a fresh conversation?"_ If not, the curation is wrong.

---

## Principle 3: Mechanical outside the LLM, judgment inside

Scripts beat LLMs at filesystem walks, parsing, hashing, and deterministic
execution. LLMs beat scripts at intent classification, edge case
enumeration, semantic detection, and architectural judgment. The line is
not "less LLM is better" -- it is "put each job where it wins." Edge
case bucketization is judgment; it belongs in Opus inline. Directory
traversal is mechanical; it belongs in a script.

**Why this matters:** Every token spent on mechanical work is a token
not spent on reasoning, and mechanical work executed by an LLM is
slower, more expensive, and less reliable than the same work as a
script. The inverse is also true: forcing judgment into a regex or a
rule engine produces brittle systems that fail on the first novel case.
Misplacing work in either direction costs quality.

**How devorch enforces this:**
- `map-project.ts` (structural snapshot), `check-project.ts` (lint/type/build/test runner), `tldr-analyze.ts` (TS structural extraction), `phase-summary.ts` (commit message + state), `archive-plan.ts` (move plan to archive) -- mechanical
- Explore depth, plan structure, edge case enumeration, guardian review, builder dispatch -- judgment, inline Opus
- Plan validation and DAG correctness -- judgment by the planner; orchestrator self-checks before dispatch
- Post-edit lint hook -- mechanical

**Validation question:** _"Is an LLM doing mechanical work, or a script
pretending to exercise judgment?"_ Either misplacement is a defect.

---

## Principle 4: Parallelism follows the dependency DAG

Phases declare explicit dependencies on other phases. Tasks within a
phase declare disjoint file scopes. Anything not connected by a dep
runs in parallel; anything connected runs sequentially. There are no
"waves" inside a phase and no fixed ordering between phases beyond what
deps require. The DAG is the only ordering constraint.

**Why this matters:** Sequential pipelines waste real time when work is
genuinely independent — and most non-trivial features have independent
sub-pieces (telemetry separate from business logic, docs separate from
code, two unrelated modules touched by the same request). Forcing them
serial just to have a "clean ordering" is ceremony. At the same time,
parallel-by-default is wrong: when phase B depends on phase A's output,
running them in parallel produces broken builds. The DAG models the
real dependency, nothing more, nothing less.

**How devorch enforces this:**
- Plan format declares `depends-on` per phase (defaults to no deps)
- Tasks within a phase use disjoint file lists, enforced by the planner
- Build scheduler dispatches every phase whose deps are satisfied and whose files don't overlap with currently-running phases
- Quality gates and reviewers run in parallel after the full DAG completes — they all read the same final HEAD
- Discovery (explore + guardian) runs in parallel against the same inputs

**Validation question:** _"Is there a dependency between A and B that
forces serial execution, or is the ordering just convention?"_ If
convention, it should be parallel.

---

## Principle 5: Enumerate before; ask only real bifurcations

Edge cases are always enumerated before execution and always surfaced
transparently. But enumeration is not the same as interrogation.
Cases resolved by code convention or explicit in the request are
recorded and skipped. Only real bifurcations -- decisions with
legitimate trade-offs the user must own -- become questions. The gate
is single-shot, offering "None", "All", or specific numbers. Zero
questions is a valid outcome.

**Why this matters:** Clarification is how devorch avoids the
exponential cost of building the wrong thing. But over-clarification
trains the user to ignore the gate. A prompt that asks six questions
when three were obvious from the code is noise; the fourth time it
happens, the user clicks "all defaults" without reading. Transparency
plus selective asking preserves signal.

**How devorch enforces this:**
- Edge cases bucketed into: resolved-by-code, resolved-by-request, real-bifurcation
- Bucket counts surfaced in a transparency block before any question
- Single `AskUserQuestion` gate with None/All/Numbers selector
- Recommendations are provided inline with each bifurcation, with one-line rationale
- Zero-bifurcation paths proceed without interrupting the user

**Validation question:** _"Is each question a trade-off the user must
own, or something the code or the request already answers?"_ If the
latter, resolve it silently and log it in the transparency block.

---

## Principle 6: Code is contextual truth; industry is normative

The codebase tells you what the project is. Industry standards tell you
what the project should be. Both matter, but they are not equivalent.
Conventions extracted from the repo enter as context, not as law --
they describe local reality and remain substitutable. Industry patterns
(OWASP, N+1, pagination, idempotency) enter as norms the guardian
checks against. When the two diverge, the guardian surfaces the gap
rather than silently enforcing either.

**Why this matters:** Pretending the code is always right means
propagating existing bugs and anti-patterns. Pretending industry
standards are always right means fighting legitimate local constraints
(legacy boundaries, migration half-states, deliberate trade-offs). The
honest posture is: describe what is, name what should be, let the user
decide when they diverge.

**How devorch enforces this:**
- Code is read directly by builders — conventions derivable from the code
  (naming, style, imports) are not re-extracted by a script
- `.devorch/GOTCHAS.md` captures only what code does **not** self-document:
  deliberate workarounds, non-obvious invariants, anti-patterns retained by
  trade-off. Never bulk-generated by script — grows organically as real
  sessions surface real surprises, curated by the orchestrator per the
  strict quality bar in the command spec
- Gotchas are passed as context, not as rules, in builder slices
- Guardian evaluates code against industry standards (OWASP, performance, architecture)
- Divergences become heads-up items or bifurcations, not silent rewrites
- `.devorch/standards-silenced.md` lets the project record accepted divergences

**Validation question:** _"Am I treating code as prescriptive, or as the
current state against which a norm is being checked?"_ The code describes;
GOTCHAS.md warns about what the code does not say; norms prescribe; the
user decides when they meet.

---

## Principle 7: Fail fast, fix with context

Errors are cheapest to fix when the agent that caused them still has
full context. Deferring validation to the end of a multi-phase build
means the fixing agent must reconstruct intent from commit messages and
diffs -- or worse, guess. Fast failure keeps the error surface small
and the fix surface informed.

**Why this matters:** A type error in phase 1 becomes a runtime crash
in phase 3 that looks like a logic bug, consuming hours of context
reconstruction. Catching it before downstream phases run costs minutes.
The asymmetry is not marginal; it compounds with every phase that sits
on top of undetected breakage.

**How devorch enforces this:**
- Post-edit lint hook catches syntax and style on every Write/Edit
- Builders get up to 3 local retry attempts with error context before escalating
- Quality gates (lint + typecheck + build + test) run in parallel after the DAG completes, catching cross-phase integration breaks
- Reviewers split into security, performance, completeness, flags — each scoped so findings come with context, not with ambiguity

**Validation question:** _"If this error surfaces three phases from now,
will the agent fixing it still have the context of why the code was
written this way?"_ If not, validate earlier.

---

## Principle 8: Guardian is default posture

In every mode, the orchestrator operates as a senior engineer pair
reviewing the work of a well-intentioned, performance-first, self-taught
developer. The guardian is silent when the code is correct, loud when
it detects a critical heads-up. It does not teach. It redirects.

**Why this matters:** The most expensive failures are not bugs the user
knows about -- those get fixed. The expensive ones are anti-patterns
the user does not know to look for: SQL concatenation, N+1 on a hot
path, missing idempotency on a retry boundary, a worker proxying a
30MB upload. A silent assistant that just does what is asked amplifies
these. A guardian posture catches them before they become production
incidents without turning every session into a lecture.

**How devorch enforces this:**
- Guardian role applied inline during discovery, before and after explore findings consolidate
- Domain checklist: auth, rate-limiting, input validation, error boundaries,
  caching, indexing, N+1, pagination, realtime, upload path, async/queue,
  observability, idempotency, secrets, cross-tenant isolation
- Findings bucketed: heads-up critical (known right answer) vs real bifurcation
- Tone is "by this path, not that one" -- not tutorial prose
- `.devorch/profile.yml` tunes weighting (priorities, biases) without silencing

**Validation question:** _"If the user ships this as-is, will the
guardian have flagged the issues that would matter in production?"_
Silence is correct only when the code already meets the bar.

---

## Principle 9: Ceremony proportional to scope

A typo fix does not need a plan and a phase boundary. A three-module
refactor does. Devorch resolves this not by mode-grading internally,
but by drawing a sharp line at its own invocation: trivial work runs
in vanilla Claude Code; devorch is the path for medium-to-large work
that earns the full pipeline. Inside devorch, the pipeline is single
and stable -- discovery, plan, build, quality, flags -- because by the
time you invoked it, that ceremony is in scope. Right-sizing happens
at the front door, not via internal toggles.

**Why this matters:** Ceremony for small tasks is not rigor -- it is
theater that trains the user to route around the tool. If `/devorch`
takes ten minutes to rename a variable, the user will rename the
variable by hand and the guardian never sees the session. The tool
that survives is the one whose cost is shaped to the task.

**How devorch enforces this:**
- Single five-stage pipeline: discovery → plan → build (DAG) → quality → flags
- Plan always written, even for 1-task builds — anchors the completeness reviewer and DAG scheduler
- Worktrees are NOT a devorch internal — running two parallel sessions on the same repo is the user's choice (open Claude in two separate `git worktree add`'d directories), not something devorch coordinates
- Trivial work (single-file typo, rename in a known location) does not invoke devorch — vanilla Claude Code is the right tool there

**Validation question:** _"Is this work medium-or-large enough that
the full pipeline pays off, or should it run in vanilla Claude Code?"_
When in doubt of the answer, the work probably belongs in vanilla --
devorch's ceremony amortizes only when there is real coordination to
manage.

---

## Anti-Principles: What devorch Deliberately Avoids

### "Just use a bigger context window"

Larger context is a dispatch enabler, not a quality substitute. A 1M
window lets the orchestrator hold coordination inline -- scripts,
guardian role, validation. It does not let the orchestrator hold source code,
debug traces, and builder retries without paying the lost-in-the-middle
tax. The distinction: coordination context benefits from centralization;
implementation context must stay focused and isolated in builders.

### "Let the LLM figure it out"

LLMs are excellent reasoners but inefficient computers, and they are
excellent classifiers but brittle parsers. Asking an LLM to walk a
directory tree or count dependencies wastes tokens that should go to
judgment. Asking a regex to classify user intent produces a system
that shatters on the first novel phrasing. The rule is not "less LLM";
it is mechanical outside, judgment inside. Misplacing work in either
direction is a defect.

### "One agent can do everything"

A single long-running agent accumulates context debt with every
action. By hour two, it is reasoning against a mixture of its own
edits, its own errors, its own retries, and the original request --
none of them cleanly separable. Multiple short-lived agents with
curated slices produce consistently higher quality. The coordination
overhead is real and worth paying.

### "Ship fast, validate later"

Deferred validation creates compound errors. A type error in phase 1
becomes a runtime crash in phase 3 that looks like a logic bug. The
fix then requires reconstructing context the original builder already
had and discarded. Fast failure inside builders plus parallel quality
gates after the DAG keep the error surface small and the fix surface
informed.

### "Worktrees solve everything"

Internal worktrees were a v1 attempt to isolate devorch's work from
the user's branch. They created more pain than they solved: cache
desync, merge dance, satellite path confusion, archival commits
fighting `.gitignore`. The honest model is simpler: devorch commits
directly to the current branch. If the user wants two parallel
sessions on the same repo, they create two `git worktree add`'d
directories themselves and run a separate Claude Code in each. Devorch
does not need to know this happened.

### "Ceremony signals seriousness"

A plan, a review cycle, and a phase boundary are not inherently
rigorous -- they are inherently expensive. Applying them to a
three-line typo fix is theater, not diligence. The shaping happens at
the invocation boundary: vanilla Claude Code for trivial edits,
devorch for medium-to-large work. Internal mode toggles --
"lite devorch", "quick devorch" -- create a different failure: a tool
with no clear identity, where users can't predict the cost and end up
routing around it. The clean interface is one ceremony level per
tool, with the user picking the right tool for the job.

---

## When to Revisit This Document

Review these principles when:
- Claude Code ships a major new feature (new agent system, context changes, etc.)
- A devorch build produces lower quality than expected -- name the violated principle
- Considering whether to replace a devorch component with a native alternative
- The context window changes significantly (2M, 10M, effectively unbounded)
- The pipeline's ceremony cost drifts out of proportion with the medium-to-large target scope

The principles themselves may evolve, but changes should be deliberate
and justified -- not reactive to feature announcements or one-off
session frustrations.
