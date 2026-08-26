# Decisions: Devorch Hub (dashboard de sessões)

## Scope of v1
- **Question**: Which actions ship in the first build (beyond live monitoring)?
- **Decision**: Everything at once — start build with model form, embedded terminal, answer spec conflicts from the page, merge button.
- **Rejected**: staged rollout (monitor + build + terminal first) — user wants the full loop closed in v1; read-only v1 — defers the stated goal of starting builds from the page.

## Frontend stack
- **Question**: Vanilla single-file page vs React + Vite.
- **Decision**: Vanilla single-file HTML + JS served by the Bun server; xterm.js vendored locally.
- **Rejected**: React/Vite — adds a build step and dependencies to a scripts-only repo for 4 state views.

## Test strategy
- **Question**: The devorch repo is testless; add tests for the dashboard server?
- **Decision**: bun:test for the server (session listing, idempotent tmux spawn, SSE endpoints). The page itself is covered by the build's visual gate.
- **Rejected**: staying testless — the server triggers builds; regressions there are expensive and cheap to test.

## Viewports
- **Question**: Desktop-only or desktop + mobile?
- **Decision**: Desktop 1440×900 + mobile 390×844. No tablet.
- **Rejected**: desktop-only — monitoring from the phone is a real use case.

## Spec-conflict answering UX
- **Question**: Free text vs structured options when answering blocked-on-spec from the page.
- **Decision**: Orchestrator's options rendered as radio cards (recommended highlighted) + optional note, PLUS a third "Outra resposta" free-text card as a full alternative — the free text becomes the amendment verbatim.
- **Rejected**: options-only (original recommendation; user wanted the free-text escape hatch); free-text-only — less standardized amendments.

## Idea phase from the page
- **Question**: Can `/devorch idea` run from the dashboard?
- **Decision**: v1 — "Nova sessão" button (description field + prototype toggle) spawns the tmux window running `/devorch idea` and auto-opens the embedded terminal with write unlocked; the grill happens in the terminal (AskUserQuestion renders there). v2 candidate — native grill cards in the page via a pendingQuestions protocol in session.json, same mechanics as the conflict cards.
- **Rejected**: native grill UI in v1 — needs a question/answer protocol in session.json; disproportionate to v1.

## Mobile actions
- **Question**: Actions available on mobile or monitor-only?
- **Decision**: Full actions on mobile too (start build, terminal, answer conflicts, merge). Terminal and forms adapted to 390px.
- **Rejected**: mobile monitor-only (was the recommendation; user overrode).

## Browser notifications
- **Question**: Notification API on key state changes?
- **Decision**: Not in v1. Live SSE updates only; whoever looks, sees.
- **Rejected**: notifications on verdict/blocked/failed — deferred, candidate for v2.

## Recorded without asking (single clear answer)
- Server binds to 127.0.0.1 only — the page triggers commands; LAN exposure would be unauthenticated remote command execution.
- Start-build is idempotent: checks `tmux has-session` + session.json stage before spawning; double click = one build.
- Builds started from the page always run with `--headless` (the final merge question would hang an unattended session). Requires adding the `--headless` flag to `/devorch build`.
- Merge from the page opens the tmux window AND auto-opens the embedded terminal (merge may ask on contradictory conflicts).
- One tmux window per session, named `devorch-<session>`.
- fs.watch with ~200ms debounce before pushing SSE.
- Terminal opens read-only (`tmux attach -r`); write access behind an explicit unlock click.
- Code lives in the devorch repo (`dashboard/`), installed by install.ts; port 7777, overridable via env.
- Aesthetic: dark utilitarian, Space Grotesk + JetBrains Mono, status-hue system (cyan running, green done, amber blocked, violet spec-ready) — settled visually in the prototype canvas.

## Spec-lint note: missing mobile baselines (spec-ready, merge)
The approved canvas has mobile artboards only for build, blocked and terminal. The spec-ready and merge mobile views were not prototyped: they reuse the same mobile patterns (stacked cards, bottom action bar). Gate 2 validates those two screens on mobile against the acceptance checklists instead of baselines. Deliberate; not a gap to fix before build.
