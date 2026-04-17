# Flow issue: Multi-repo satellite support missing in /devorch --full

**Captured**: 2026-04-17
**Origin session**: v3 design + implementation
**Mode**: full
**Severity**: gap

## Ready-to-paste prompt

```
/devorch --full "Add satellite-repo support to /devorch --full (Phase 1 only). Detect <secondary-repos> in the drafted plan, create satellite worktrees via setup-worktree.ts (use existing --secondary or --add-secondary API), pass --satellites '<json>' to phase-summary.ts (already supported), and extend merge-worktree.ts to accept --satellites '<json>' with sequential merge across repos (adopt the dry-run-all-first pattern from commands/worktrees.md § 3a). Do NOT implement proactive multi-repo detection (Phase 2) or atomic coordinated rollback (Phase 3) in this task — they are follow-ups."
```

## Context

- **Where**: `commands/devorch.md § F1` + `§ F7` + `scripts/merge-worktree.ts`
- **What happened**: `/devorch --full` does not create satellite worktrees and does not pass the `--satellites` JSON to downstream scripts. If a plan declares `<secondary-repos>`, `init-phase.ts` exits with `Satellite worktree for '<name>' not found at ...`.
- **Expected**: `/devorch --full` should match the v2 multi-repo flow (`/devorch:talk` → `/devorch:build` → `/devorch:worktrees merge` coordinated).
- **Workaround used**: documented explicitly in `commands/devorch.md § F7` — users route multi-repo through `/devorch:worktrees` (v2) for now.

## Phased approach

**Phase 1 (this task) — Satellite worktree creation + merge propagation**
- In `F1`, after the plan is drafted and validated, parse `<secondary-repos>` from the XML.
- For each entry, call `setup-worktree.ts` with the appropriate satellite flag (verify script API — `--secondary` on initial call vs `--add-secondary` after primary exists).
- In `F3e`, build `satellites` JSON from `init-phase` output and pass `--satellites '<json>'` to `phase-summary.ts` (already supported — see `scripts/phase-summary.ts:19`).
- In `F7`, extend `merge-worktree.ts` to accept `--satellites '<json>'`. Iterate repos sequentially: dry-run all first (no-commit no-ff then abort), then commit per-repo. Adopt the pattern from `commands/worktrees.md § 3a`.

**Phase 2 (separate issue) — Proactive multi-repo detection**
- Guardian in `Step 3` detects multi-repo signals in `$ARGUMENTS` (keywords: "sync between", "across", "from A to B", mentions of multiple repo names).
- If detected, ask about satellite inclusion with `AskUserQuestion` using the pattern in `commands/talk.md:117` (present sibling-repo paths as clickable options).
- Hook into `map-project.ts` sibling detection output so candidates are surfaced automatically.

**Phase 3 (separate issue) — Atomic coordinated merge**
- `merge-worktree.ts` runs dry-run `git merge --no-commit --no-ff --abort` on every repo FIRST. If any fails, abort all, no commits.
- Only if all dry-runs pass, commit per-repo sequentially.
- Include `fix-migration-journal.ts` per repo where applicable.

## Related

- `docs/V3-TEST-PLAN.md` Issue #9 — multi-repo support missing in F1 and F7
- `docs/V3-TEST-PLAN.md` Issue #7 — `--satellites` not passed in phase-summary
- `commands/worktrees.md § 3a` — existing v2 coordinated merge pattern
- `commands/talk.md:117` — sibling repo discovery AskUserQuestion pattern
- `scripts/phase-summary.ts:19` — `--satellites '<json>'` flag already implemented
- `scripts/init-phase.ts:416-423` — where the failure manifests without satellites
