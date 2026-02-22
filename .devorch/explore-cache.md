# Explore Cache
Generated: 2026-02-22T00:00:00Z

## Adversarial Review Dispatch Logic
Current classification in build.md step 3c:
- **Trivial** (auto-evident fix): Edit inline. Examples: TODO/FIXME, unused import, typo, formatting
- **Complex** (multi-file, design decision, regression risk): Generate `/devorch:fix` prompt

Report template (3d) has sections: Correções Automáticas (trivial fixes), Issues Pendentes (devorch:fix prompts), Verdict.

fix.md classification (step 2):
- **FIX**: contained scope, obvious "how", no design decisions. Examples: rename type across files, bug with clear root cause, missing validation, behavior per spec
- **TALK**: requires design decisions, multiple approaches, structural impact. Examples: new multi-component feature, architecture refactor, non-trivial API changes

Key insight: build.md currently only fixes "trivial" issues but fix.md's FIX classification is broader — includes multi-file mechanical changes with clear approach.

## Context and Risk Assessment
- Final verification runs INLINE in build.md (not as Task) — context budget is shared
- 3 adversarial agents + cross-phase Explore all run as first-level Task calls
- Commit pattern: fix trivials → single commit `fix(check): ...` → re-run check-project.ts
- Re-run cascade risk: fix → check → new error → fix loop. Need bounded retry.
- Only build.md step 3c needs changes — no other files reference dispatch logic
- build-phase.md has no review dispatch (by design)
- check-project.ts is read-only reporter, no fix capability
