Generated: 2026-02-21T17:57:21.498Z

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
b2a2953 Merge branch 'devorch/robust-multi-repo'
e653125 chore: add .gitattributes to enforce LF line endings
ab7e8f8 phase(3): init-phase.ts valida campo repo dos tasks, build-phase.md roda check-project em satellites e coleta status explicitamente
79c4fc5 phase(2): map-project.ts detecta repos irmãos automaticamente e talk.md integra detecção
7410994 phase(1): Adicionar flags --recreate e --add-secondary ao se...
8caeba9 feat(setup-worktree): add --recreate and --add-secondary flags
6aa5f56 chore(devorch): add worktree for robust-multi-repo
8e932ae chore(devorch): plan — Robust Multi-Repo — Worktree Resilience + Build Validation
dbdee83 Merge branch 'devorch/optimize-build-scripts'
925faeb fix(check): sync local check-project.ts with global --with-validation changes
```