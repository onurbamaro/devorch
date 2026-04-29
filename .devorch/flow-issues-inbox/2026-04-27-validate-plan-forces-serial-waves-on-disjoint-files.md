# validate-plan forces serial waves even on disjoint files

**Timestamp**: 2026-04-27
**Severity**: nit

## Prompt
/devorch "make validate-plan.ts honor disjoint <relevant-files> across same-repo tasks in the same wave. Today it blocks any wave with 2+ same-repo tasks regardless of file overlap, citing 'builders sharing a worktree see each other's WIP during typecheck/lint'. That's a real concern when tasks touch the same files, but for genuinely disjoint touches (different routes/modules) the typecheck/lint contention is bounded and serializing them adds avoidable wall time. Either: (a) only block when <relevant-files> overlap, OR (b) keep the block but make it advisory with an opt-in `<execution> parallel-with-shared-worktree</execution>` flag that the plan author can use after weighing the risk."

## Context

- **Where**: Step 8, `validate-plan.ts`.
- **What happened**: I drafted phase 1 with 2 wave-1 tasks (`client-mech-fixes`, `admin-tracks-overhaul`) that target fully disjoint files (`team.tsx`+`upload.tsx` vs `track-admin.ts`+`super-admin.tracks.tsx`+`admin-tracks.ts`+`track-admin.ts` shared types). Validator blocked with `Wave 1 in phase 1 has 2+ tasks targeting Repo "primary"`. I had to split into Wave 1 + Wave 2 — adding ~3-4 minutes of wall time since the second builder can't start until the first commits.
- **Expected**: For disjoint file sets, parallel dispatch should be allowed. The "builders see each other's WIP" risk is real only when files overlap.
- **Workaround**: Split into two waves, accepted the extra serialization.
