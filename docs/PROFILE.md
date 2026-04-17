# PROFILE

Spec for `.devorch/profile.yml` — optional user/project preferences that
shape how the guardian weighs bifurcations and phrases heads-ups.

## Purpose

The guardian evaluates every request against industry patterns in security,
performance, architecture, and operations. When a legitimate trade-off
surfaces (a bifurcation), the guardian needs priorities to break ties and
biases to nudge its recommendation. `profile.yml` is that input. Absent the
file, the guardian falls back to implicit defaults. Present, it overrides
them — globally across all projects, or per-project when the local file
exists.

## Format

```yaml
# Ordered list. First entry wins ties. Valid values:
#   performance — latency, throughput, cost-per-request
#   security    — OWASP surface, secret handling, tenant isolation
#   cost        — infra spend, build minutes, egress
#   dx          — developer experience, debuggability, iteration speed
#   simplicity  — fewer moving parts, less abstraction, boring tech
priorities: [performance, security, cost, dx]

# Free-form list. Each entry is `prefer: <tag>` or `avoid: <tag>`.
# Canonical tags the guardian already understands:
#   stateless-clients, edge-processing, direct-storage-access,
#   server-side-buffering, synchronous-workers
# Custom tags are allowed — the guardian treats them as soft hints and
# may ask for clarification if ambiguous.
biases:
  - prefer: stateless-clients
  - prefer: edge-processing
  - prefer: direct-storage-access
  - avoid: server-side-buffering
  - avoid: synchronous-workers
```

## Resolution order

1. `~/.devorch/profile.yml` (global, user-level defaults)
2. `<project>/.devorch/profile.yml` (per-project overrides)

Merge is per-key, not deep: if the per-project file defines `priorities`,
it fully replaces the global list. Same for `biases`. Missing keys inherit
from the global file. No file at either level means defaults apply.

## Integration with guardian

The `/devorch` command reads both files at start, merges them, and injects the
result into the guardian prompt as structured context. The guardian uses
it during bucketization:

- Resolving a tie between two valid options in a bifurcation — first
  matching entry in `priorities` wins.
- Biasing the recommendation line — `prefer:`/`avoid:` tags appear as
  explicit justifications rather than implicit assumptions.
- Adjusting the heads-up threshold — a `prefer: edge-processing` profile
  makes the guardian flag server-side buffering more aggressively, where
  a neutral profile might stay silent.

Example flow. User asks for an upload endpoint. Guardian detects two
legitimate approaches: proxy through worker (simpler integration) vs
signed URL direct to storage (lower cost, higher throughput). With
`priorities: [performance, ...]`, the guardian writes:

```
Bifurcação 1: Upload path
  A) Signed URL direto para storage — cliente POSTa direto, worker
     recebe webhook de conclusão. Custo: ~0. Throughput: limitado só
     pelo storage.
  B) Proxy via worker — worker recebe multipart, reencaminha. Custo:
     N workers × ~30MB RAM por sessão. Simples de integrar.
  Recomendação: A — seu profile prioriza performance e prefere
  direct-storage-access. Custo de B é explícito, não implícito.
```

Without the profile, the guardian would present both options neutrally
and ask which to take. The profile does not hide the trade-off — it
shifts the default when the user has not asked.

## Defaults when absent

No `profile.yml` at any level means the guardian operates with implicit
ordering:

```
security > performance > dx > cost
```

Biases default to empty. This is intentionally conservative — without a
signal, the guardian assumes the user wants correct-by-default behavior
over fast-by-default. A user who prefers otherwise should write a profile.

## When to override per-project

Global profile reflects how you usually build. Per-project overrides kick
in when a specific repo has different constraints:

- Legacy codebase where stability beats raw performance — bump `security`
  and introduce `stability` as a custom priority tag.
- Compliance-bound project (healthcare, finance) — pin `security` first,
  demote `performance`.
- Internal tool with 3 users — `dx` and `simplicity` first, `performance`
  near the bottom.

Override only the keys that differ. Leave the rest to inherit.

## Examples

### Performance-first solo dev (global)

```yaml
# ~/.devorch/profile.yml
priorities: [performance, cost, dx, security]

biases:
  - prefer: stateless-clients
  - prefer: edge-processing
  - prefer: direct-storage-access
  - avoid: server-side-buffering
  - avoid: synchronous-workers
```

### Compliance-first project (per-project override)

```yaml
# .devorch/profile.yml inside a healthcare app
priorities: [security, performance, dx, cost]

biases:
  - prefer: defense-in-depth
  - prefer: audit-logging
  - avoid: third-party-analytics
  - avoid: client-side-pii
```

### Prototyping / throwaway (per-project override)

```yaml
# .devorch/profile.yml inside a weekend prototype
priorities: [dx, simplicity, performance]

biases:
  - prefer: boring-tech
  - avoid: premature-abstraction
  - avoid: microservices
```
