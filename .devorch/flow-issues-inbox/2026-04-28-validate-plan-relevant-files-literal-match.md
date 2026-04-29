# Validate-plan relevant-files match is literal, not basename-aware

**Timestamp**: 2026-04-28
**Severity**: nit
**Prompt**: `/devorch "Make validate-plan.ts <relevant-files> declared-paths matching basename-aware (or path-suffix-aware): if the plan declares 'src/infra/http/server.ts' and a task body backticks 'server.ts', treat the latter as declared. Currently the literal string comparison emits false-positive 'tem <relevant-files> vazio mas menciona paths no body' warnings."`

## Where
`/home/bruno/.claude/devorch-scripts/validate-plan.ts` ~line 376–388 (`fileMentionRegex` + `planDeclaredPaths.has(p)` set lookup).

## What happened
The plan-level `<relevant-files>` block listed full paths like `src/infra/http/server.ts`, `src/modules/ninetynine-food/99food.signature.ts`. Task bodies frequently shorten via backticks to just the basename: \`server.ts\`, \`99food.signature.ts\`. The validator emitted warnings like:

> Task receiver-99food-async tem `<relevant-files>` vazio mas menciona paths no body: server.ts, 99food.signature.ts, 99food.api-client.ts, 99food.outbound-queue.ts. Declare-os explicitamente em `<relevant-files>` para que wave-overlap detection funcione.

Each of those was already declared at the plan level under its full path. The literal `Set.has()` comparison fails because basenames don't match full paths.

## Expected
Either accept basename matches (when the basename uniquely identifies a file in `<relevant-files>`), or accept any path that is a suffix of a declared path. False positives flood the warnings list and obscure real issues.

## Suggested fix
Build the `planDeclaredPaths` Set with both the full path and its basename. Then check `planDeclaredPaths.has(p) || planDeclaredPaths.has(basename(p))`. Two-line change, low risk.

Edge case: if two different declared full paths share the same basename, basename-only match would be ambiguous. Could fall back to path-suffix match, or require full path in those rare cases.
