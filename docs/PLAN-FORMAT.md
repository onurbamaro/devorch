# Plan Format

Canonical plan format for `/devorch`. Plans live at
`<worktreePath>/.devorch/plans/<name>.md` and are validated by
`scripts/validate-plan.ts`. The builder dispatcher (`scripts/init-phase.ts`)
parses the structure below to produce per-task context slices.

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

<new-files>
- `path/to/new/file` — what it is
</new-files>

<!-- optional — only when plan involves multiple repos: -->
<secondary-repos>
- `<name>` — /absolute/or/relative/path/to/repo
</secondary-repos>
<!-- When present, the orchestrator passes `[{name, path, status?}]` to
     phase-summary.ts and merge-worktree.ts, where `path` is the satellite's
     repoPath (the repo root). merge-worktree.ts resolves `.worktrees/<name>`
     internally; phase-summary.ts reads only name + status. -->
</relevant-files>

<!-- optional — cross-cutting invariants: -->
<global-invariants>
Cross-cutting invariants that apply to all phases (e.g., API envelope format, auth patterns, error code registry).
- invariant description
</global-invariants>

<phase1 name="Name">
<goal>one sentence</goal>

<spec>
<interface name="unique-name">
  <input>parameter descriptions with types</input>
  <output>return value description with types</output>
  <error case="error-name">expected behavior</error>
</interface>
<error-contract name="unique-name">
  <case trigger="condition" handling="expected behavior" />
</error-contract>
<behavior name="unique-name">
  <precondition>what must be true before</precondition>
  <postcondition>what must be true after</postcondition>
</behavior>
<invariant name="optional-name">condition that must always hold</invariant>
<endpoint path="/path" method="METHOD">
  <request>schema or description</request>
  <response status="NNN">schema or description</response>
</endpoint>
<entity name="EntityName">
  <field name="fieldName" type="string" />
  <relationship target="OtherEntity" type="belongs-to" />
  <constraint>business rule or validation that must hold</constraint>
</entity>
</spec>

<!-- optional — directed exploration for build phase: -->
<explore-queries>
- "public API and exports of src/modules/auth" — for task auth-refactor
- "error handling patterns in src/api/handlers" — for task error-handling
</explore-queries>

<tasks>
#### 1. <Task Name>
- **ID**: <kebab-case>
- **Assigned To**: devorch-builder
- **Repo**: <name>                       <!-- optional, default: primary. Use secondary repo name when the task targets a satellite -->
- **Spec refs**: <comma-separated spec names>   <!-- optional — references <spec> children by name -->
- **Exemplars**: src/a.ts, src/b.ts              <!-- optional — file paths the builder should mirror -->
- **Non-goals**: one-line description            <!-- optional — explicit exclusions -->
- <specific action>
- <specific action>

</tasks>

<execution>
**Wave 1** (parallel): <task-id-a>, <task-id-b>
**Wave 2** (after wave 1): <task-id-c>
</execution>

<criteria>
- [ ] <measurable criterion>
</criteria>

<handoff>
<what the next phase needs to know — required for all phases except the last>
</handoff>
</phase1>

<phase2 name="Name">
<!-- same structure as phase1 -->
</phase2>
```

## Rules

- Phases are numbered `<phase1>`, `<phase2>`, etc. `validate-plan.ts` enforces
  consecutive numbering starting at 1.
- Each phase MUST have `<goal>`, `<tasks>`, `<execution>`, `<criteria>`. Last
  phase may omit `<handoff>`.
- Tasks in the same wave MUST NOT modify the same file. `init-phase.ts` does
  not enforce this by itself — waves are trusted from the plan author.
- `<spec>` children are **named** (`name="..."`) and referenced by **Spec refs**
  in tasks. A task with no spec reference receives the full phase spec block.
  `<invariant>` accepts either an explicit `name="..."` or the implicit ordinal
  (`invariant-1`, `invariant-2`, ...); both forms resolve to the same element.
- Task **Repo** is optional; omit it for primary-repo tasks. Required when the
  task targets a satellite (must match a name from `<secondary-repos>`).
- `<secondary-repos>` is the single source of truth for satellites. If present,
  `/devorch` creates satellite worktrees in Step 8 before the phase loop starts.
- `<global-invariants>` applies to every phase but is not delivered per-task to
  builders — surface it via Spec refs where needed.

## Consumer scripts

- `validate-plan.ts` — structural validation, invoked after plan draft.
- `init-phase.ts` — per-phase context assembly: filters conventions/cache/specs
  per task, emits `sliceWarnings` when slices fall under 3K or over 30K tokens.
- `phase-summary.ts` — writes `state.md` + emits commit message at phase end.
- `merge-worktree.ts` — coordinated merge across primary + satellites.

## Validation checklist

- [ ] `# Plan: <name>` header present
- [ ] `<description>`, `<objective>`, `<classification>`, `<decisions>` blocks present
- [ ] Phases numbered consecutively from 1
- [ ] Every task has `ID` and `Assigned To: devorch-builder`
- [ ] Every non-trivial task has at least one Spec ref OR is explicitly exempt
  (pure config/docs/trivial one-file chore)
- [ ] `<execution>` wave mapping matches declared task IDs
- [ ] Satellite-repo tasks carry a `Repo:` line matching a `<secondary-repos>` entry
