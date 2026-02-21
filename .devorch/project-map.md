Generated: 2026-02-21T17:09:48.520Z

# Project Map

**Directory**: `/home/bruno/dev/devorch`

## Tech Stack

- Node.js / JavaScript
- Bun
- TypeScript

## Structure

```
devorch/
  LICENSE
  install.ts
  uninstall.ts
  bun.lock
  nul
  ... +3 files
  agents/
    devorch-builder.md
  hooks/
    post-edit-lint.ts
    devorch-statusline.cjs
  scripts/
    setup-worktree.ts
    phase-summary.ts
    list-worktrees.ts
    run-validation.ts
    manage-cache.ts
    ... +8 files
    lib/
  commands/
    build.md
    talk.md
    fix.md
    worktrees.md
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
dbdee83 Merge branch 'devorch/optimize-build-scripts'
925faeb fix(check): sync local check-project.ts with global --with-validation changes
7399114 phase(3): Atualizar build-phase.md para usar phase-summary.t...
9d73bfc phase(1): Criar script que gera commit message e escreve sta...
c458fd1 chore(devorch): add worktree for optimize-build-scripts
30f78a1 chore(devorch): plan — Optimize Build Scripts — Reduce Think Cycles
5c69570 Merge branch 'devorch/satellite-worktrees'
5d28b39 fix(check): add JSON array validation, encoding consistency, and duplicate path check
aa8db0b phase(3): Merge dry-run + sequencial em todos os repos, list...
17a7259 feat(worktrees): add satellite listing, coordinated merge, and cascading delete
```