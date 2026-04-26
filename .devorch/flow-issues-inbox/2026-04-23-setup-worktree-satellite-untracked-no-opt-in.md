# setup-worktree.ts: satellite-untracked blocks setup with no opt-in

**Timestamp**: 2026-04-23
**Mode**: full
**Severity**: nit

## Prompt pronto

```
/devorch --full "add --allow-devorch-dirt or similar opt-in to setup-worktree.ts --add-secondary so untracked .devorch/**.md files in sibling repos don't block satellite creation. Currently the atomicity guard aborts and requires manual git stash in the sibling repo."
```

## Contexto mínimo

**Onde**: `setup-worktree.ts --add-secondary`, atomicity guard at the `satellite-untracked` check.

**O que aconteceu**: On this session, `/home/bruno/dev/dochron` had one untracked file `.devorch/flags-admin-subscription-visibility.md` (a FLAGS.md from a prior devorch review). Setting up the satellite failed with:
```json
{"ok": false, "error": "satellite-untracked", "satellite": "dochron", "repoPath": "/home/bruno/dev/dochron", "untrackedFiles": [".devorch/flags-admin-subscription-visibility.md"]}
```

**Esperado**: User's devorch-namespaced artifacts (`.devorch/flags-*.md`, `.devorch/state.md`, `.devorch/project-map.md`, `.devorch/explore-cache-*.md`) are the tool's own outputs, not user work that would be lost. An opt-in flag like `--allow-devorch-dirt` OR automatic ignore of `.devorch/**.md` patterns would let the satellite creation proceed without the user-visible stash/pop ceremony.

**Workaround aplicado**: `git stash push -u -m "devorch-satellite-setup-temp"` on the satellite repo, retry, stash pop after satellite creation.

**Impacto**: small friction (~30s), but the stash/pop sequence is error-prone if orchestrator forgets to pop.
