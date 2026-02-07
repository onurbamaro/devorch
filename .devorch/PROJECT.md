# Project Map

**Directory**: `C:\Users\bruno\Documents\Dev\devorch`

## Tech Stack

- Node.js / JavaScript
- Bun
- TypeScript

## Structure

```
devorch/
  bun.lock
  install.ts
  nul
  package.json
  README.md
  ... +2 files
  agents/
    devorch-builder.md
    devorch-validator.md
  commands/
    build-all.md
    build.md
    check-implementation.md
    make-plan.md
    make-tests.md
    ... +5 files
  hooks/
    devorch-statusline.cjs
    post-edit-lint.ts
  scripts/
    check-project.ts
    extract-criteria.ts
    extract-phase.ts
    hash-plan.ts
    map-conventions.ts
    ... +2 files
```

## Dependencies (top 15)


**Dev:**
- bun-types: ^1.3.8

## Scripts

- `install`: bun run install.ts
- `uninstall`: bun run uninstall.ts

## Recent Commits

```
f529459 chore(devorch): map conventions
ff77894 feat(make-plan): explore before asking, mandatory thorough clarification
8899adb docs: rewrite README with full command coverage and architecture details
084aaee fix(make-plan): auto-archive completed plans without prompting
4375b10 perf(check): parallelize automated checks with Explore agents
a194111 fix: use $CLAUDE_HOME paths and improve builder task completion
2e278f2 refactor(statusline): simplify to project name and context bar only
895e3da fix(quick): enforce opus model for Explore agents and use $CLAUDE_HOME
b179506 feat(state): split state history to prevent context bloat, use opus everywhere
7518d3d feat(build): add cache eviction, convention filtering, and builder retry
```
