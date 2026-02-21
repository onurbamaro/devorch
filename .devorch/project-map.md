Generated: 2026-02-21T01:57:06.094Z

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
    list-worktrees.ts
    run-validation.ts
    manage-cache.ts
    format-commit.ts
    ... +7 files
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
4acb24f feat(worktrees): detect main branch dynamically
a7dfd4d chore(devorch): add project config and update explore cache
46f9035 docs: update README for devorch v2
2755396 phase(3): Remover arquivos deprecated e atualizar install.ts...
8bbc223 chore(devorch): update installer for v2 structure
79f7557 chore(devorch): remove deprecated v1 files
76a3288 chore(devorch): rewrite build system for v2
251d90b feat(devorch): add talk.md and fix.md commands for v2
d94d2ab chore(devorch): plan — devorch v2 3 comandos com Agent Teams
263f5c8 Merge branch 'devorch/optimize-build-performance'
```