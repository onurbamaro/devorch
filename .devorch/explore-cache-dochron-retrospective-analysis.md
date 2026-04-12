# Explore Cache
Generated: 2026-04-12T00:00:00Z

## devorch-philosophy-architecture

devorch (v2.0.0) is a multi-agent orchestration framework for Claude Code. It solves: context debt in single-agent sessions, inability to parallelize, LLMs doing mechanical work, and requirement ambiguity propagating into code.

**7 Core Principles**: (1) Orchestrator stays light — builders run in isolated contexts, (2) Fresh context beats accumulated context — each builder gets curated ~6-10K token context, (3) Compute outside the LLM — scripts handle mechanical work, (4) Structure enables parallelism — plans have phases/waves/tasks with file boundaries, (5) Clarify before you build — mandatory AskUserQuestion rounds, (6) Code is source of truth — conventions analyzed from real code, (7) Fail fast, fix with context — post-edit lint + per-phase check.

**Pipeline**: talk (explore → clarify → spec → plan) → build (init-phase → explore if needed → builders in waves → contract verify → phase check → final review → merge) → optional fix for contained issues.

**Key trade-offs**: Context isolation over convenience, scripts over LLM computation, mandatory clarification over speed, per-phase validation over end-validation, worktree isolation over in-place editing, auto-memory rejected for conventions.

## dochron-git-history-timeline

**DoChron**: Motorsport telemetry platform — Bun + Hono backend, React + TanStack Router frontend, PostgreSQL + Drizzle, Redis + BullMQ, MinIO, Expo mobile. Built in 10 days (Apr 2-12), 724 commits on main, 44 devorch branches merged.

### Timeline
- Apr 2-3: Initial commit, GoPro import, S/F editor, coach dashboards (60 commits)
- Apr 5: Mockups (3 rounds), GPS alignment, sport categories, full frontend V1 (77 commits)
- Apr 6: **Monster day** — 183 commits, 9 branches. Corner detector v1→v2 (20+ algo commits), data arch redesign, user management, role guards
- Apr 7: Auth overhaul start, braking detector, upload recovery, security fixes (66 commits)
- Apr 8: Security crits, management screens rebase (46 commits)
- Apr 10: Foundation backend (pino, Sentry, PostHog, CI), data arch API contracts, UUID v7, telemetry storage migration, auth overhaul, billing system (109 commits)
- Apr 11: Mobile (3 phases), 3 contract alignment passes (contract-type-alignment → costura-phase-8 → costura-sessions-1-8-v3) (101 commits)
- Apr 12: Admin UX, design system, mock→implement screens, pre-prod cleanup (78 commits)

### Hotspots
- api.ts (38 touches, 2066 lines, finally deleted Apr 11)
- server/index.ts (32 touches)
- db/schema.ts (30 touches, 21 tables added)
- routes/tracks.ts (25 touches)
- routes/sessions.ts (25 touches)
- analysis.tsx (24 touches)

### Rework Evidence
- Management screens worktree: built Apr 7, abandoned, fully rebuilt as "rebase" Apr 8 (478 MB dead worktree)
- 3 contract alignment passes in one day (Apr 11) — type drift accumulated across 8 implementation sessions
- Upload pipeline redesigned 3 times across 5 branches over 3 days
- Corner detection: 20+ commits in one day, full v2 rewrite next day, archived to research/ day 10
- Fix ratio: 17.6% (128 fix/724 total)

## dochron-rework-patterns-classified

### Architecture Misses
1. **pilots/users split** — separate entities from day 1, merged into one table on day 5. Cascade: nullable phone broke ranking/invites/admin/client types across 9+ files. Fix: domain model sketch before coding.
2. **Telemetry in Postgres bytea** — migrated to MinIO on day 8. 4,335 insertions/650 deletions across 19 files. MinIO was already a dependency. Fix: storage architecture decision before first migration.
3. **No shared API schema** — inline Zod schemas + monolithic api.ts (2066 lines). Required 3 branches + 16,278 lines to create shared/api/. Fix: contract-first design.

### Integration Failures
4. **Envelope format not agreed** — server switched to `{data: T}` envelopes, client still read raw. 8 bugs discovered in one review commit. Fix: single serialization contract document.
5. **Upload pipeline** — 3 complete redesigns: sync → async BullMQ → schema redesign for metadata → orphan/retry fix. Fix: sequence diagram for upload+failure paths.
6. **Billing webhook insecure** — mTLS header bypass, insufficient signature verification. Dedicated security hardening branch. Fix: security checklist on billing feature spec.
7. **Coupon rollback broken** — usedCount incremented BEFORE gateway call; ambassador commission hardcoded; placeholder user data. Fix: transaction boundary diagram + "what if gateway fails?" question.

### Spec Gaps
8. **Auth redesigned twice** — WhatsApp OTP only → full email/password+OTP (7,209 ins/878 del). Phone nullable cascade broke 6+ files. Fix: auth methods specced before first schema.
9. **WhatsApp link preview consumed magic link** — well-known platform behavior not researched. Fix: platform research before choosing delivery channel.
10. **PIX field names wrong** — gateway field names not matched to Efí API docs. Fix: read API docs before integration.

### Edge Case Blindness
11. **S/F bearing double-rotation** — two code paths each added 90°, rendered parallel instead of perpendicular. Fix: comment on column semantic.
12. **D3 chart zoom — 4 failures in 63 min** — React+D3 overlay lifecycle conflict. Brush removed entirely. Fix: decide React+D3 ownership model before charting.
13. **CONCURRENTLY in Drizzle migration** — can't run inside transaction. Fix: know your tools.
14. **int16 overflow for accelerometer** — GoPro mg values can exceed int16 range. Fix: 10-min data range calculation.
15. **IDOR on 3 separate endpoints** — sessions, tracks DELETE, notification read. All caught by post-hoc review. Fix: security checklist per endpoint.

### Scope Creep
16. **Design system token naming drift** — `--space-*` vs `--spacing-*` coexisted, required full codebase grep-and-replace. Fix: agree token names before any component uses them.

### What Would Have Prevented Most Rework (4 documents, ~2-4 hours)
1. **Domain model sketch** (30 min): users have roles, no pilots table, phone nullable
2. **API contract document** (1 hour): envelope format, /v1/ prefix, all field names
3. **Storage architecture** (15 min): blobs → MinIO, metadata → Postgres, upload flow
4. **Security checklist** (15 min): ownership check on every mutating endpoint

## devorch-spec-system-diagnosis

### Current Spec Format Supports (but doesn't enforce)
- Domain model: partially, via `<interface>` workaround (no native `<entity>` or `<schema>` element)
- API contracts: yes, via `<endpoint>` — but per-phase, per-plan, no global mechanism
- Security: yes, via `<error-contract>` — but not required for mutating endpoints

### 7 Specific Gaps Found in devorch

1. **No domain model spec element** — `<interface>`, `<behavior>`, `<invariant>`, `<endpoint>`, `<error-contract>` exist but no `<entity>` or `<schema>`. Planners must shoehorn domain model into `<interface>`.
2. **Missing spec = warning, not block** — `validate-plan.ts` line 268 emits WARNING for missing `<spec>`. Plan proceeds. All 3 earliest dochron plans had 0 spec sections.
3. **No global/cross-plan API contract** — specs scoped per-phase per-plan. Envelope format must be re-stated per plan. No `<api-convention>` element.
4. **No auth requirement for mutating endpoints** — `<endpoint>` only requires path, method, ≥1 `<response>`. No `<error-contract>` required for POST/DELETE/PATCH/PUT. Validation passes without auth mention.
5. **Spec refs optional** — tasks without `**Spec refs**` skip contract verification entirely (`talk.md` line 396). Early dochron plans had tasks with no specs and no refs.
6. **DA agent can't surface what doesn't exist** — Devil's Advocate reviews proposed specs, but if no security spec exists at all, DA has nothing to challenge. No mandate to check "every mutating endpoint needs auth error-contract."
7. **No security question in clarification** — Step 3 lists 11 question categories; "security" is not one. Ownership checks discovered post-hoc by completeness-reviewer, not pre-build by specs.

### Would Current System Have Caught Dochron's Top 3 Problems?
- **pilots/users split**: NO — no domain model spec element, no validation, no question that asks "describe entity relationships"
- **No API envelope contract**: NO — per-endpoint/per-plan scope, no global mechanism, early plans had 0 specs
- **Missing ownership checks**: NO — auth error-contracts not required by format or validation, IDOR caught only by post-hoc review

### 6 Proposed Fixes
1. Add `<entity>` spec element type for domain model (fields, relationships, constraints)
2. Promote missing `<spec>` from warning to error for feature/migration/enhancement plans with complexity ≥ medium
3. Require auth annotation on mutating `<endpoint>` elements (JWT required or public)
4. Add plan-level `<global-invariants>` section for cross-cutting concerns (envelope format, error codes)
5. Upgrade DA mandate: "For every mutating endpoint in relevant-files, verify auth error-contract exists"
6. Add mandatory security question to Step 3 clarification: "Who can call each endpoint? What happens on unauthorized access?"

## dochron-mobile-integration-patterns

### Overview
212 commits, 10 days (Apr 2-12). Rework ratio ~50% (105 of 212 commits are fix/refactor/align/rewrite). The codebase-fixes devorch session catalogued 4 CRITICAL, 7 HIGH, 5 MEDIUM, 4 LOW integration issues all present simultaneously.

### Dominant Pattern: Shadow Type Systems
Three independent type definitions for same backend resources:
- **Ranking**: `ranking-types.ts` had `pilotId, pilotName, bestLapTimeMs` — none exist in backend. Entire ranking screen/sync rebuilt from scratch (300+ line diff)
- **Sessions sync**: local `ApiSession` declared `bestLapMs, consistency, topSpeedKmh` — backend returns raw `laps[]` array. All stats had to be computed client-side.
- **Auth User**: had phantom `email` field, missing `nickname, photoUrl, region`. `loginRequestSchema` had `min(8)` vs backend `min(1)`.

### Silent Failures (worst category)
- **createTrack**: sent `sfLatitude/sfLongitude`, backend accepts `latitude/longitude`. Zod silently strips → NULL coords in DB → downstream lap re-split failure. No error anywhere.
- **Error envelope**: mobile parsed `{code, message}`, backend sends `{error: {code, message}}`. All error handling returned `undefined`.
- **Upload retry**: called POST (create) instead of GET (refresh). Each retry created orphan upload+session records.

### Root Cause
Features built by inventing local types instead of importing from `shared/api/`. The shared schema directory existed but wasn't used as source of truth during feature development — only enforced retroactively via bulk sync (17 files, 419 lines) + api.ts rewrite (792 lines deleted).
