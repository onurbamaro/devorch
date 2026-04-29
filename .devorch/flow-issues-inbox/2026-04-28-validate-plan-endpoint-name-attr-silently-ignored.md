# Validate-plan silently ignores `<endpoint name="...">` attribute

**Timestamp**: 2026-04-28
**Severity**: nit
**Prompt**: `/devorch "Make validate-plan.ts respect the optional name attribute on <endpoint> (use it as the spec key when present, fall back to '<METHOD>-<path>' auto-generation otherwise) AND surface this convention in docs/PLAN-FORMAT.md and in the validator error message when a Spec ref points to a non-existent endpoint."`

## Where
- `/home/bruno/.claude/devorch-scripts/validate-plan.ts` — the parser around `parseSpecNames()` / endpoint-name resolution
- `/home/bruno/dev/devorch/docs/PLAN-FORMAT.md` § Template line 82–85: `<endpoint path="/path" method="METHOD">` shown without `name=`

## What happened
Plan declared `<endpoint path="/api/clientes" method="GET" name="endpoint-clientes">` (mirroring the visible `<entity name="...">` and `<behavior name="...">` pattern from the same PLAN-FORMAT). Tasks referenced this via `Spec refs: endpoint-clientes`. Validator returned:

```
Task clientes-backend references spec 'endpoint-clientes' which is not defined.
Available specs in phase 1: ..., GET-/api/clientes
```

Same for promoções (`endpoint-promocoes` → had to become `GET-/api/promocoes`). The `name` attribute was silently dropped in favor of auto-generated `<METHOD>-<path>`. Two rounds of edits before validation passed.

## Expected
Either:
- **(a)** the `name` attribute should be honored on `<endpoint>` like every other spec child, OR
- **(b)** PLAN-FORMAT.md should explicitly say "endpoints DO NOT support the name attribute; the spec key is auto-generated as `<METHOD>-<path>`" and the validator's error should include "(endpoint specs are auto-named)" hint.

## Suggested fix
Implement (a) — read `name` attribute first; if absent, fall back to `<METHOD>-<path>`. Cheap to add (~5 lines in the endpoint parser) and aligns with the rest of the spec naming surface. PLAN-FORMAT.md line 82–85 can stay as-is since the optional `name=` would just inherit the documented "named children referenced by Spec refs" semantics.
