# check-project parallel typecheck+build race on Astro repos

**Timestamp**: 2026-04-28T17:50Z
**Severity**: blocker

## Prompt
`/devorch "make check-project run build then typecheck sequentially when both are scheduled — Astro repos regenerate .astro/types.d.ts during build, which a concurrent tsc reads and trips on"`

## Context

`check-project.ts` schedules all checks via `Promise.all` (around line 174). On Astro repos, `astro build` regenerates `.astro/types.d.ts` (used by `tsconfig.extends "astro/tsconfigs/strict"`). Concurrent `tsc --noEmit` reads `.astro/types.d.ts` mid-flight and fails non-deterministically with `exit code 2` (or empty stderr / a benign Bun script-echo line like `$ tsc --noEmit`).

## What happened

Running `merge-worktree.ts --worktree order-tracker-with-map --satellites '...'` halted at the post-rebase check-project step with `typecheck: fail: $ tsc --noEmit`. Manual `bunx tsc --noEmit` and standalone `bun run typecheck` both exited 0. Even adding an explicit `typecheck` script to `package.json` didn't help — the failure persisted because the race is about concurrent file access, not script wiring. Re-running `check-project --quick` 4× in a row reproduced the failure 4/4 times when build was scheduled in parallel; in isolation typecheck always passed.

## Expected

Build and typecheck either (a) run sequentially when both are scheduled — build first, then typecheck, since build is the producer of `.astro/types.d.ts` — or (b) typecheck waits on a write lock for `.astro/`.

## Workaround used

Skipped `merge-worktree.ts` and ran `git merge --no-ff` manually for primary + satellite (dry-run had already cleared atomicity). Plan archive, worktree removal, branch deletion done by hand. Cost: ~10 minutes of debugging + 6 commands of manual cleanup. The fact that the dry-run passed but the real run failed at a flaky harness step (with the underlying code clean) is the key friction — the harness blocked a successful merge.

## Suggested fix

In `check-project.ts`, when `--quick` is set (build + typecheck), schedule typecheck AFTER build's `await`. Or detect Astro projects (presence of `astro.config.*`) and serialize. Sequential cost is small (typecheck ~6s, build ~3s = 9s instead of ~6s parallel) and removes the entire race class.

Alternative: add `--skip-check` to `merge-worktree.ts` so a failing check that the user can verify-clean manually doesn't block merge.
