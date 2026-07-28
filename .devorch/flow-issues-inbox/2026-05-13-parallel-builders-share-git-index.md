# Parallel devorch-builder tasks contaminate git index in shared worktree

Timestamp: 2026-05-13

Severity: gap

Prompt pronto:
```
/devorch "ensure each devorch-builder uses --only or pathspec-bound commit so parallel tasks in the same worktree do not absorb sibling-staged changes"
```

## Contexto

Onde: `agents/devorch-builder.md` (or similar) workflow when 5 phase-1 tasks dispatched in parallel via single Task tool call.

O que aconteceu: In session `prepublication-playstore-fixes`, the `hooks-fix-graficos` builder ran `git add <its-file>` followed by `git commit` and inadvertently absorbed 2 file deletions (gopro-parser.ts, gopro-telemetry.d.ts) staged by the sibling `gopro-parser-delete` task. Commit `8dcad30` ("fix(hooks): move hooks before early return") thus contains unrelated deletions. The sibling task's eventual commit (`f24935f`) became a comment-only update because its file deletions had already been absorbed.

Esperado: each builder's commit should only contain that task's declared `**Files**`.

Workaround usado: none — accepted muddled git log attribution since net diff was correct.

Solução durável: builder agent definition should require either:
- `git commit -- <pathspec>` (pathspec-only commit, ignores other staged changes)
- `git commit --only <files>` (same idea, explicit)
- or `git stash` siblings' staged changes before commit, then restore

Multiple builders in the same session reported this exact friction (see their build reports for "flow friction" sections).
