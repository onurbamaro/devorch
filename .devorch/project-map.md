# Project Map

**Directory**: `/home/bruno/dev/devorch/.worktrees/devorch-evolve-quality-waves`

## Tech Stack

- Node.js / JavaScript
- Bun
- TypeScript

## Structure

```
devorch-evolve-quality-waves/
  LICENSE
  install.ts
  uninstall.ts
  bun.lock
  README.md
  package.json
  tsconfig.json
  docs/
    build-phase-reference.md
    EVOLUTION.md
    PHILOSOPHY.md
  agents/
    devorch-builder-deep.md
    devorch-builder.md
  hooks/
    post-edit-lint.ts
    post-compact-state-refresh.ts
    devorch-statusline.cjs
  scripts/
    setup-worktree.ts
    tldr-analyze.ts
    phase-summary.ts
    list-worktrees.ts
    manage-cache.ts
    merge-worktree.ts
    init-phase.ts
    check-project.ts
    archive-plan.ts
    map-conventions.ts
    check-conventions-staleness.ts
    validate-plan.ts
    map-project.ts
    fix-migration-journal.ts
    lib/
      plan-parser.ts
      args.ts
      git-utils.ts
      fs-utils.ts
  commands/
    build.md
    talk.md
    fix.md
    worktrees.md
```

## Dependencies (top 15)

**Production:**
- ts-morph: ^27.0.2

**Dev:**
- bun-types: ^1.3.8

## Scripts

- `install`: bun run install.ts
- `uninstall`: bun run uninstall.ts

## Recent Commits

```
076305e chore(devorch): plan — evolve devorch quality waves
376a8eb Merge branch 'devorch/reduce-context-noise'
b37cdb1 wip: pre-session edits to agents, commands, hooks, evolution doc
0116487 feat(init-phase): tighten EXT_KEYWORDS + detect Fast-path classification marker
a3da3e3 refactor(map-conventions): trim Patterns section to Module boundaries top-5
703d8fa feat(validate-plan): accept optional Fast-path field in classification
032bfd2 docs(talk): propagate Fast-path marker and --compact invocation in talk command
56831b6 feat(map-project): add --compact flag for fast-path context reduction
c7d6633 chore(devorch): plan — reduce context noise
320da45 chore(devorch): cleanup post-merge spec-system-improvements
```

## Sibling Repos

- `optimize-build-performance` — ../optimize-build-performance (branch: master)