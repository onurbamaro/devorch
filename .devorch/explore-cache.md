# Explore Cache
Generated: 2026-02-22T14:45:00Z

## Devorch File Lifecycle Analysis

### File Inventory & Handling

| Arquivo | Criado por | Commitado? | Cleanup? |
|---|---|---|---|
| `plans/current.md` | talk.md → worktree | Sim (worktree) | Nunca (fica após merge) |
| `plans/archive/*` | archive-plan.ts | Sim (main) | Nunca |
| `state.md` | phase-summary.ts | Sim (worktree) | talk.md Step 9 deleta ao iniciar novo plano |
| `explore-cache.md` | talk.md Step 2 | Sim (main) | manage-cache.ts (trim/invalidate) |
| `CONVENTIONS.md` | talk.md Step 1 | Sim (ambos) | Nunca |
| `project-map.md` | map-project.ts --persist | Sim (main) | Nunca |
| `.phase-context.md` | init-phase.ts | Não (temp) | Fim da phase |
| `ARCHITECTURE.md` | talk.md (novos projetos) | Sim | Nunca |
| `config.json` | Manual | Sim | Nunca |
| `state-history.md` | Manual | Sim | Nunca |
| `team-templates.md` | Manual | Sim | Nunca |

### Commit Patterns

**talk.md Step 10 — No main repo:**
- Commita `explore-cache.md` e `CONVENTIONS.md` com msg `chore(devorch): add worktree for <name>`

**talk.md Step 10 — Na worktree:**
- Commita `plans/current.md` e `CONVENTIONS.md` com msg `chore(devorch): plan — <name>`

**build.md — Na worktree:**
- Cada phase commita work + `state.md` com msg `phase(N): <goal>`

### Gaps Identificados

1. **Nenhum comando limpa arquivos do main repo após merge** — `state.md`, `plans/current.md` que vêm da worktree ficam no main após merge
2. **`project-map.md` fica stale** — talk.md roda com `--persist` mas nunca atualiza/remove depois
3. **`explore-cache.md` só cresce** — `manage-cache.ts` faz trim (3000 linhas) e invalidate, mas nunca deleta seções antigas de planos já concluídos
4. **`plans/archive/` acumula indefinidamente** — sem mecanismo de rotação
5. **`.gitignore` não exclui `.devorch/`** — todos os arquivos são versionados, incluindo state temporário
6. **Após merge de worktree, arquivos `.devorch/` da worktree entram no main** — `state.md` e `plans/current.md` de worktrees merged ficam no histórico do main

## Current Merge Section (Section 4 of build.md)
The merge step runs in the **orchestrator context** (build.md), not delegated to builders. It:
1. Detects worktree branch + main branch
2. Detects satellites from plan file `<secondary-repos>`
3. Asks user: "Merge now" or "Keep worktree"
4. If merge with satellites: dry-run ALL repos first (atomic check), then merge sequentially, then cleanup
5. If merge without satellites: checkout → merge → worktree remove → branch delete
6. **Assumes working tree is clean** in all repos — no handling for uncommitted changes

Key variables: `<projectRoot>`, `<mainBranch>`, `<worktreeBranch>`, `<repoMainPath>`, `<worktreePath>`

## Git Stash Edge Cases
Critical findings for the stash+merge workflow:

1. **--ours/--theirs is INVERTED after stash pop** — after `git stash pop` conflicts:
   - `--ours` = HEAD (post-merge state, i.e. the worktree branch changes merged in)
   - `--theirs` = stashed changes (pre-merge local modifications)
   - The user's original proposal had this backwards

2. **Stash pop auto-drops on success, keeps entry on failure** — must track whether to drop manually

3. **`git stash push` with no tracked changes** = "No local changes to save" (exit 0, no entry created). Must filter `git status --porcelain` to exclude `??` lines before deciding to stash.

4. **After failed stash pop**: repo is in merge-conflict state with conflict markers. NOT a clean state.

5. **Don't use --include-untracked** — risks stashing build artifacts, node_modules. Filter status output instead.

6. **Merge fails after stash**: need to `merge --abort` then `stash pop` to restore state.

7. **Multi-repo coordination**: stash/dry-run/merge/pop must be coordinated across primary + satellites.

## Style Patterns for build.md
- Top-level sections: `### N. Section Name`
- Sub-steps: numbered lists (1., 2., a., b., c.)
- Single commands: inline backticks. Multi-line sequences: ```bash code blocks
- Conditionals: English prose "If X: do Y"
- Error handling: "report error and stop", "verify X, if not Y"
- Imperative verbs: "Run", "Parse", "Check", "Detect", "Report"
- Variables: angle brackets `<varName>` for runtime values
- Merge section is orchestrator-context (uses AskUserQuestion, git commands directly)
