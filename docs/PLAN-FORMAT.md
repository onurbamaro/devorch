# Plan Format

Canonical plan format for `/devorch`. Plans live at
`.devorch/plans/<name>.md` and drive the build scheduler.

## Template

```markdown
# Plan: <descriptive name>

<description>
<what we're building/changing>
</description>

<objective>
<measurable goal — what's true when this plan is complete>
</objective>

<classification>
Type: <type>
Complexity: <complexity>
Risk: <risk>
</classification>

<decisions>
<user choices from the clarification step — each as a one-line "Question → Answer" pair>
<include ALL user answers that affect implementation, even if they seem obvious>
</decisions>

<!-- if medium or complex: -->
<problem-statement>
<specific problem or opportunity>
</problem-statement>

<solution-approach>
<approach, alternatives considered, rationale>
</solution-approach>
<!-- end if -->

<relevant-files>
- `path/to/file` — why it's relevant
</relevant-files>

<new-files>
- `path/to/new/file` — what it is
</new-files>

<!-- optional — cross-cutting invariants: -->
<global-invariants>
Cross-cutting invariants that apply to all phases (e.g., API envelope format, auth patterns, error code registry).
- invariant description
</global-invariants>

<phase id="schema" name="Database schema">
<depends-on></depends-on>

<goal>one sentence</goal>

<spec>
<entity name="Session">
  <field name="id" type="uuid" />
  <field name="userId" type="uuid" />
  <constraint>userId references users(id)</constraint>
</entity>
<behavior name="session-expiry">
  <precondition>session createdAt + ttl < now</precondition>
  <postcondition>session marked invalid</postcondition>
</behavior>
</spec>

<tasks>
#### 1. <Task Name>
- **ID**: <kebab-case>
- **Files**: `db/migrations/0042_sessions.sql`, `src/db/types/session.ts`
- **Spec refs**: Session, session-expiry
- **Exemplars**: `db/migrations/0040_users.sql`
- **Non-goals**: session refresh logic (next phase)
- <specific action>
- <specific action>
</tasks>

<criteria>
- [ ] migration applies cleanly to a fresh DB
- [ ] type matches schema columns 1:1
</criteria>

<handoff>
<what the next phase needs to know — required for all phases except leaves of the DAG>
</handoff>
</phase>

<phase id="api" name="Session API">
<depends-on>schema</depends-on>

<goal>...</goal>
<!-- same structure -->
</phase>

<phase id="telemetry" name="Login telemetry">
<depends-on></depends-on>

<goal>...</goal>
<!-- runs in parallel with `schema` and `api`; touches different files -->
</phase>
```

## Rules

- **Phase IDs are explicit** (`<phase id="schema">`), not numeric. The orchestrator uses IDs to resolve `depends-on` references.
- **`<depends-on>`** lists comma-separated phase IDs that must complete before this phase can start. Empty (`<depends-on></depends-on>`) means no deps — runs as soon as the build starts.
- **DAG must be acyclic.** The orchestrator self-checks before dispatch.
- **Files are declared per task** in a `**Files**: ...` line. The full set of files a task touches must be listed; do not rely on the orchestrator to infer.
- **Disjoint files within a phase** — two tasks in the same phase MUST NOT list the same file. The planner enforces this when drafting; the orchestrator self-checks before dispatch.
- **Disjoint files across parallel phases** — two phases that can run concurrently (no dep chain between them) MUST NOT touch the same file. The orchestrator self-checks; if violated, the planner is asked to redraft.
- **`<spec>` children are named** (`name="..."`) and referenced by **Spec refs** in tasks. A task with no spec reference receives the full phase spec block.
- **Last phases** (DAG leaves) may omit `<handoff>`.
- **Trivial mechanical fixes can be bundled** — multiple small disjoint changes belong in a single task with bullet-points, not separate tasks. Threshold: combined spec under ~500 tokens, all disjoint files, mechanical (flag adds, regex tweaks, hint strings, doc rewrites). Reserve separate tasks for genuinely independent units of judgment.

## Scheduling semantics

The build scheduler maintains a set of phases and dispatches as follows:

1. Compute **ready set** = phases whose `depends-on` are all `[DONE]` AND that are not yet started AND whose declared files don't overlap with any currently-running phase.
2. Dispatch every phase in the ready set in parallel. Within each dispatched phase, all tasks fire in parallel (one Task tool call per task in the same assistant message).
3. When all tasks of a phase commit successfully, mark phase `[DONE]` in the plan file and recompute the ready set.
4. Loop until all phases are `[DONE]` or a builder fails irrecoverably.

A phase with no `depends-on` and no file overlap with another no-dep phase will start on iteration 1 alongside other independent phases — that is the source of cross-phase parallelism.

## Marking progress

The orchestrator updates the plan file in place as phases complete. The scheme:

- Pending phase: `<phase id="schema" name="Database schema">`
- Completed phase: `<phase id="schema" name="Database schema" status="done">`

This is the only state mutation made to the plan file during build. On `/devorch --resume`, the orchestrator re-reads the plan, treats `status="done"` phases as already complete, and computes the ready set from there.

## Validation checklist (orchestrator self-checks before dispatch)

- [ ] `# Plan: <name>` header present
- [ ] `<description>`, `<objective>`, `<classification>`, `<decisions>` blocks present
- [ ] Every phase has unique `id`, `name`, `<goal>`, `<tasks>`, `<criteria>`
- [ ] Every task has `**ID**` and `**Files**: <list>`
- [ ] DAG (declared via `<depends-on>`) has no cycles and no references to undefined phase IDs
- [ ] Within each phase, declared files are disjoint
- [ ] Across any pair of phases that could run concurrently (no dep chain in either direction), declared files are disjoint
- [ ] Every non-trivial task has at least one Spec ref OR is explicitly exempt (pure config/docs/trivial one-file chore)
