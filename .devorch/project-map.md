Generated: 2026-02-19T02:17:51.245Z

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
  LICENSE
  nul
  package.json
  ... +3 files
  agents/
    devorch-builder.md
    devorch-validator.md
  commands/
    build-tests.md
    build.md
    check-implementation.md
    debug.md
    devorch.md
    ... +4 files
  hooks/
    devorch-statusline.cjs
    post-edit-lint.ts
  scripts/
    archive-plan.ts
    check-agent-teams.ts
    check-project.ts
    extract-criteria.ts
    format-commit.ts
    ... +11 files
    lib/
  templates/
    build-phase.md
```

## Dependencies (top 15)


**Dev:**
- bun-types: ^1.3.8

## Scripts

- `install`: bun run install.ts
- `uninstall`: bun run uninstall.ts

## Recent Commits

```
bc3a38d Merge branch 'devorch/devorch-unification'
cca8c40 fix(check): remove team-templates.md direct reads from devorch.md
c498bba chore(devorch): update state — phase 4 complete
d20aee9 docs(devorch): update README for unified /devorch command
86e7685 chore(devorch): update cross-references for unified /devorch command
52a0f8d chore(devorch): delete obsolete make-plan.md and quick.md commands
12667bc feat(devorch): add unified /devorch command with 3-path routing
b11bda6 refactor(templates): update commands and templates for consolidated script interfaces
77216a7 refactor(scripts): infra scripts use shared lib, map-project gains --persist
79dc1d7 refactor(scripts): plan-related scripts use shared lib imports
```