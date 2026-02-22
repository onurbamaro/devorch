Generated: 2026-02-22T14:45:16.496Z

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
eeb48c9 Merge branch 'devorch/merge-stash-preflight'
cf6a146 phase(1): Adicionar lógica de stash automático ao step 4 do build.md para lidar com working tree sujo
809df21 phase(1): build.md adds pre-flight stash to merge workflow
24dd5d0 chore(devorch): add worktree for Merge Stash Pre-flight
0f1e071 chore(devorch): plan — Merge Stash Pre-flight
b2a2953 Merge branch 'devorch/robust-multi-repo'
e653125 chore: add .gitattributes to enforce LF line endings
ab7e8f8 phase(3): init-phase.ts valida campo repo dos tasks, build-phase.md roda check-project em satellites e coleta status explicitamente
79c4fc5 phase(2): map-project.ts detecta repos irmãos automaticamente e talk.md integra detecção
7410994 phase(1): Adicionar flags --recreate e --add-secondary ao se...
```

## Sibling Repos

- `salsago-print-server` — ../salsago-print-server (branch: master)
- `cost-system` — ../cost-system (branch: master)
- `salsago-courier` — ../salsago-courier (branch: master)
- `rastreia-reports` — ../rastreia-reports (branch: master)
- `ducoins` — ../ducoins (branch: master)