# devorch Philosophy

> This document captures the core principles behind devorch.
> Use it as a litmus test when evaluating new Claude Code features:
> if a native feature honors these principles, adopt it.
> If it violates them, keep the devorch approach.

---

## Principle 1: The Orchestrator Must Stay Light

The orchestrator's context window is sacred. It should never grow proportionally
to the size of the work being done. A 2-hour build across 15 tasks should leave
the orchestrator at roughly the same context size as a 10-minute build with 2 tasks.

**Why this matters:** LLM quality degrades with context size -- not because the
model runs out of space, but because attention becomes diluted. At 300K tokens,
the model is statistically less likely to recall a decision made at token 10K.
The 1M context window enables the orchestrator to coordinate more efficiently --
holding phase logic, script outputs, and builder dispatch inline -- but it does
not change the fundamental principle: focused context beats diluted context.
Coordination overhead can safely live in the orchestrator's window; implementation
details must stay in isolated builder contexts.

**How devorch enforces this:**
- Builder agents run in isolated contexts that are destroyed after each task
- Only structured summaries (state.md, handoffs) flow back to the orchestrator
- Exploration happens in separate Explore agents -- findings are cached, not inlined
- Scripts compute results outside the LLM and return only JSON output
- Per-task filtering ensures builders receive only conventions and cache relevant to their task

**Validation question:** _"Does this change cause the orchestrator's context to
grow with the number of tasks?"_ If yes, it violates Principle 1.

---

## Principle 2: Fresh Context Beats Accumulated Context

A builder working on task #15 should have the same quality of context as the
builder working on task #1. This is impossible when all work happens in a single
conversation -- by task #15, the context contains 14 tasks worth of code diffs,
lint outputs, error messages, and fix attempts that are irrelevant noise.

**Why this matters:** Context compaction (automatic summarization of old messages)
is lossy by definition. Critical architectural decisions, naming conventions, and
edge cases discussed early in a session can be lost or distorted when compacted.
Each compaction is an irreversible information loss event.

**How devorch enforces this:**
- Each builder receives a curated, minimal context: plan excerpt + conventions +
  relevant explore-cache + phase handoff (~6-10K tokens total)
- Builders never see other builders' work, errors, or intermediate states
- Phase handoffs are explicit and structured -- not compressed conversation history
- The explore-cache is filtered per-task to include only relevant discoveries

**Validation question:** _"Does task N have worse context quality than task 1?"_
If yes, it violates Principle 2.

---

## Principle 3: Compute Outside the LLM When Possible

Every token the LLM spends on mechanical computation (parsing files, running
regex, counting dependencies, detecting conventions) is a token not spent on
reasoning. Scripts are deterministic, fast, and free in terms of context cost.

**Why this matters:** When the LLM runs `Glob` + `Read` + `Grep` to understand
a project's structure, it spends 15-20K tokens on tool calls and reasoning about
results. A script like `map-project.ts` does the same work in 200ms and returns
a 2K token structured result. The LLM gets better input at 10x less context cost.

**How devorch enforces this:**
- `map-project.ts` -- discovers tech stack, folder structure, dependencies
- `map-conventions.ts` -- analyzes code patterns, generates CONVENTIONS.md
- `init-phase.ts` -- loads and filters all phase context in one call
- `check-project.ts` -- runs lint/typecheck/build/test in parallel
- `validate-plan.ts` -- validates plan structure deterministically
- `phase-summary.ts` -- generates commit messages + state updates
- `manage-cache.ts` -- trims explore-cache without LLM involvement

**Validation question:** _"Is the LLM doing work that a script could do
deterministically and faster?"_ If yes, write a script.

---

## Principle 4: Structure Enables Parallelism

Unstructured work is inherently sequential. Structured plans with explicit
phases, waves, and task boundaries enable safe parallel execution. The upfront
cost of creating a good plan pays for itself many times over in execution speed.

**Why this matters:** A 5-task wave running in parallel finishes in the time of
the slowest task, not the sum of all five. But parallelism is only safe when
tasks have explicit boundaries -- which files they touch, what they depend on,
and what they produce.

**How devorch enforces this:**
- Plans define phases with explicit goals and success criteria
- Waves group tasks that can safely run in parallel (no shared file modifications)
- Task IDs enable dependency tracking and progress monitoring
- Validation runs after each phase catch integration issues before they propagate
- The plan format is validated by `validate-plan.ts` before execution begins

**Validation question:** _"Can this work be safely parallelized with explicit
boundaries?"_ If yes, structure it into waves.

---

## Principle 5: Clarify Before You Build

Ambiguity in requirements propagates exponentially through implementation.
A misunderstood requirement in phase 1 can invalidate all subsequent phases.
Forced clarification rounds before planning eliminate the most expensive kind
of rework: building the wrong thing.

**Why this matters:** The cost of asking 3 clarifying questions is ~2 minutes.
The cost of rebuilding 3 phases because a requirement was misunderstood is hours.
LLMs are naturally eager to start working -- devorch's mandatory clarification
rounds counteract this bias.

**How devorch enforces this:**
- `/devorch:talk` requires at least one `AskUserQuestion` round before planning
- Exploration happens before clarification, so questions are informed by code reality
- Decisions are recorded in the plan's `<decisions>` section and persist through execution
- Builders receive these decisions as context, ensuring alignment through all phases

**Validation question:** _"Am I confident enough in the requirements to commit
to a multi-phase plan?"_ If not, ask more questions.

---

## Principle 6: Code Is the Source of Truth

The codebase is always more authoritative than cached summaries, previous
conversation context, or the LLM's training data. Every exploration should
read actual code. Every convention should be derived from actual patterns.

**How devorch enforces this:**
- `map-conventions.ts` analyzes real code to generate CONVENTIONS.md
- Explore agents read actual files, not cached descriptions
- The explore-cache has TTL-like behavior (invalidated when relevant files change)
- Builders are instructed to verify assumptions against actual code before modifying

---

## Principle 7: Fail Fast, Fix With Context

Errors are cheapest to fix when the agent that caused them still has full context.
Deferring validation to the end means the fixing agent must rebuild context from
scratch -- or worse, guess at intent.

**How devorch enforces this:**
- Post-edit lint hook catches syntax/style errors on every Write/Edit
- `check-project.ts` runs after each phase while builders still have context
- Builders get one retry loop to fix their own errors before escalating
- Final adversarial review catches cross-phase issues with specialized reviewers

**Validation question:** _"Will the agent fixing this error still have the
context of why the code was written this way?"_ If not, validate earlier.

---

## Anti-Principles: What devorch Deliberately Avoids

### "Just use a bigger context window"
More context is not better context. A 50K token focused context will outperform
a 500K token diluted context on implementation quality. However, larger context
windows do enable reduced orchestration overhead -- the orchestrator can hold
coordination logic inline rather than delegating to intermediate agents. The key
distinction: orchestration context (script outputs, task dispatch, validation
results) benefits from centralization; implementation context (source code,
debugging, writing new code) must stay focused and isolated in builders.

### "Let the LLM figure it out"
LLMs are excellent reasoners but inefficient computers. Asking an LLM to parse
a package.json, count files in a directory, or detect indentation patterns is
like asking a novelist to do arithmetic. Scripts handle mechanical work; the
LLM handles judgment and creativity.

### "One agent can do everything"
A single long-running agent accumulates context debt with every action. Multiple
short-lived agents with focused contexts produce consistently higher quality
output. The coordination overhead of multi-agent orchestration is worth paying.

### "Ship fast, validate later"
Deferred validation creates compound errors. A type error in phase 1 becomes
a runtime crash in phase 3 that looks like a logic bug. Per-phase validation
keeps the error surface small and localized.

---

## When to Revisit This Document

Review these principles when:
- Claude Code ships a major new feature (new agent system, context changes, etc.)
- A devorch build produces lower quality than expected (which principle was violated?)
- Considering whether to replace a devorch component with a native alternative
- The context window changes significantly (2M+, infinite context, etc.)

The principles themselves may evolve, but changes should be deliberate and
justified -- not reactive to feature announcements.
