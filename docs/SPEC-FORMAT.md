# Spec Format

Canonical format for the spec directory produced by `/devorch idea` and
consumed by `/devorch build`. The spec is the single source of truth for a
build: the build session may start with zero conversation context and must
be able to run to verdict from these files alone.

## Location

Specs live OUTSIDE any repo, in the global session directory:

```
~/.claude/devorch-sessions/<name>/
  session.json        # live status — written via session.ts, read by /devorch merge and (future) dashboard
  spec/
    spec.md           # behavioral contracts
    decisions.md      # every resolved decision, including rejected alternatives
    manifest.json     # repos, run commands, platform, viewports, test strategy, model policy
    prototype/        # only with --prototype
      <screen>.html   # one throwaway HTML file per screen
      baselines/
        <screen>.<viewport>.png   # visual baselines for the build's visual gate
  plan.md             # written by /devorch build (PLAN-FORMAT.md)
  screenshots/        # visual-gate evidence, per round: round-1/, round-2/, final/
```

Rationale: worktrees are created per repo and destroyed at merge; a
multi-repo session has no single owning repo. The global dir survives both.
The durable record lands in git at merge time (`/devorch merge` archives
spec + plan into the primary repo's `.devorch/plans/archive/`).

## spec.md

```markdown
# Spec: <Title>

<objective>
One paragraph: what is true for the business when this ships.
</objective>

## Contract: <kebab-name>
- **Repo**: <repo-name>                     <!-- omit in single-repo specs -->
- **Screens**: `checkout`, `confirmation`   <!-- only if prototype exists; names match prototype/<screen>.html -->
- **Behavior**: <what happens, observable from outside — request in, response out, UI state, side effect>
- **Acceptance**:
  - [ ] <observable, testable criterion — a person or an e2e test can verify it>
  - [ ] <another criterion>
- **Non-goals**: <what this contract deliberately does not cover>

## Contract: <next>
...
```

Rules:
- Every contract's acceptance criteria are **observable**: verifiable by a
  test or by looking at a running screen. "Code is clean" is not a criterion.
- Contracts are the unit of spec-coverage in the build and the unit of
  spec-conflict when reality contradicts the spec.
- `**Screens**` maps contracts to prototype files; every prototype screen
  must be referenced by at least one contract (validate-spec warns otherwise).

## decisions.md

```markdown
# Decisions: <Title>

## <short decision title>
- **Question**: <the bifurcation as it was asked>
- **Decision**: <what was chosen>
- **Rejected**: <alternative A — why not>; <alternative B — why not>

## Amendment (<date>): <title>          <!-- appended by spec-conflict resolution -->
- **Conflict**: <what the build discovered>
- **Decision**: <the user's answer>
```

The Rejected line is load-bearing: it prevents the build from re-litigating
a path the user already declined. Builders receive decisions verbatim.

## manifest.json

```json
{
  "name": "checkout-pix",
  "platform": "web",
  "viewports": ["desktop", "tablet", "mobile"],
  "repos": [
    {
      "name": "salsago-go",
      "path": "~/dev/salsago-go",
      "run": "bun dev",
      "url": "http://localhost:3000",
      "testStrategy": "vitest unit + supertest API tests (existing setup)",
      "dependsOn": []
    },
    {
      "name": "salsago-web",
      "path": "~/dev/salsago-web",
      "run": "bun dev",
      "url": "http://localhost:5173",
      "env": { "API_URL": "http://localhost:3000" },
      "testStrategy": "vitest + playwright e2e (existing setup)",
      "dependsOn": ["salsago-go"]
    }
  ],
  "flows": [
    { "name": "checkout", "screens": ["cart", "payment", "confirmation"] }
  ],
  "models": {
    "idea-explore": "opus",
    "prototype": "opus",
    "build-explore": "grok",
    "explore-review": "opus",
    "builder": "grok",
    "review": "inherit",
    "mechanical": "opus",
    "fixer": "opus",
    "visual": "inherit",
    "merge": "opus"
  }
}
```

Field semantics:
- **platform**: `web` | `mobile-app` | `desktop-app` | `cli` | `api`.
  Decides the visual gate's viewport matrix (see below). `cli`/`api` skip
  the visual gate entirely — validation is tests + acceptance criteria.
- **viewports**: which sizes the visual gate shoots. Defaults by platform:
  web → all three; mobile-app → mobile; desktop-app → desktop.
  Standard sizes: desktop 1440×900, tablet 768×1024, mobile 390×844.
- **repos[].run / url / env**: how the build starts the app for the visual
  gate and e2e. `env` lets a frontend worktree point at a backend worktree.
  A repo without `run` is skipped by the visual gate (validate-spec warns).
- **repos[].testStrategy**: decided during idea — the build NEVER decides
  test infrastructure. "none (testless repo, respected)" is a valid value.
- **repos[].dependsOn**: repo-level dependency. Orders the merge
  (dependencies merge first) and informs cross-repo phase deps in the plan.
- **flows**: ordered screen sequences the visual gate walks.
- **models**: per-role model policy — see MODEL POLICY in commands/devorch.md.
  Values: `haiku` | `sonnet` | `opus` | `fable` | `grok` | `inherit`
  (inherit = the orchestrator session's model).

## prototype/

Exists to (1) validate the idea visually with the user and (2) serve as the
visual reference for the build's Gate 2. It is NOT production code and is
never copied into a repo. Two media:

- **Design canvas (preferred)** — built with the `design` skill and
  published as an editable canvas the user refines and Saves themselves.
  The approved `.dc.html` sources (one artboard per screen × viewport,
  e.g. `CartDesktop.dc.html`) are extracted into `prototype/design/` and
  are part of the spec: builders read them for exact values (spacing,
  colors, type), and Gate 2 spot-checks those values on the rendered app.
  The canvas URL is recorded in `manifest.json` as `prototype.canvasUrl`.
- **Plain HTML (fallback)** — throwaway self-contained files
  `prototype/<screen>.html` when the design skill is unavailable.

Baselines (both media): `baselines/<screen>.<viewport>.png`, kebab screen
names, captured at the standard viewport sizes. Required: desktop + mobile
for web (tablet only for screens the user flagged as tablet-critical during
the grill), mobile only for mobile-app, desktop only for desktop-app.

## Validation

`bun ~/.claude/devorch-scripts/validate-spec.ts --dir <sessionDir>/spec`
runs the mechanical checks (files exist, contracts have acceptance
checklists, manifest parses, repo paths are git repos, screens have
prototypes and baselines). Judgment-level review — ambiguity, testability,
completeness against the grill — is the orchestrator's spec-lint pass in
`/devorch idea` Stage I5.
