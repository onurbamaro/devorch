# Flags: plan-a-foundation-fixes

## architecture: Hook inlined cache-paths duplication without sync guarantee
- **Severity**: med
- **Detection**: `hooks/post-compact-state-refresh.ts:15-37`
- **Suggested fix**: Export a shared `cache-paths.mjs` to a third install location (`~/.claude/devorch-common/`) and import from both sites.
- **Alternative**: Add a runtime sanity check (hash comparison) in the hook at startup to detect divergence and fail loudly.

## architecture: `detailPath` field is absolute but documentation may assume relative
- **Severity**: low
- **Detection**: `commands/devorch.md:193,210` — documentation describes `detailPath` as opaque variable, but consumers reading it should know it's an absolute path to global cache dir.
- **Suggested fix**: Add a clarifying note: "Note: `detailPath` in the JSON output is an absolute path under `~/.claude/devorch-state/<repo-hash>/cache/phase-init-<N>/`; orchestrators must use it as-is, not resolve relative to `projectRoot`."
- **Alternative**: Change output to emit a relative path (`.devorch/cache/phase-init-<N>/`) and have orchestrators resolve it against projectRoot (re-adds complexity; current form is correct).

## ops: Legacy `.devorch/cache/` path kept in getUntrackedFiles exclude list for compatibility
- **Severity**: low
- **Detection**: `scripts/setup-worktree.ts:306` — hardcoded path includes `.devorch/cache/` for legacy user repos that may not have migrated to global cache.
- **Suggested fix**: Tag with a TODO and target removal date: `// TODO: remove after 2026-06-30 when users migrate to global ~/.claude/devorch-state cache`
- **Alternative**: Document in GOTCHAS.md that legacy exclude list is transitional.

## test: No unit tests for `cache-paths.ts` module
- **Severity**: low
- **Detection**: `scripts/lib/cache-paths.ts` — no corresponding `.test.ts` or `.spec.ts` file found in worktree.
- **Suggested fix**: Add `scripts/lib/cache-paths.test.ts` testing `resolveCacheRoot`, `getDetailPath` with worktree+mainRoot parity.
- **Alternative**: Add integration tests in a Phase 2 follow-up focused on script test coverage.

## test: `merge-worktree.ts` ENOENT retry path untested
- **Severity**: low
- **Detection**: `scripts/merge-worktree.ts:48-81` — the `git()` wrapper detects and retries on ENOENT when cwd is removed mid-cleanup, but no test exercises this branch.
- **Suggested fix**: Add a test that removes the cwd between git calls to verify the retry logic.
- **Alternative**: Document the retry as a recovery mechanism in GOTCHAS.md and mark as "covered by integration testing only."

## doc: `commitDevorchArtifact` allowlist updated but not documented in PLAN-FORMAT.md
- **Severity**: low
- **Detection**: `scripts/lib/git-utils.ts:118-123` — allowlist includes `flow-issues-inbox/` (new in this plan) but `docs/PLAN-FORMAT.md` was not reviewed for update.
- **Suggested fix**: Grep `PLAN-FORMAT.md` for mentions of "devorch artifact" or ".gitignore" and add `flow-issues-inbox/` to any documentation of the allowlist.
- **Alternative**: No action if `PLAN-FORMAT.md` is intentionally not updated (already mentioning the pattern is "all of `.devorch/`").

## doc: GOTCHAS.md entries reference old `.devorch/cache` behavior but are not stale
- **Severity**: low
- **Detection**: `scripts/merge-worktree.ts:3` — GOTCHA entry mentions `git()` wrapper trimming stdout for `removeIdenticalUntracked` comparing "bytes to git show"—this was relevant when cache lived in worktree; cache now global but the gotcha about trim() remains valid.
- **Suggested fix**: Gotcha is still load-bearing (trim affects any exact-bytes comparison); no action needed. Verify during next `/devorch "review gotchas"` run.
- **Alternative**: Add a note clarifying the gotcha applies to any byte-exact git output use, not tied to the old cache location.

## doc: self-build detection examples missing from Steps 9d, 9e parenthetical
- **Severity**: low
- **Detection**: `commands/devorch.md:224,227` — Steps 9d and 9e have self-build parenthetical, but Step 9a (line 193) has it while later invoking examples may not all show substitution consistently.
- **Suggested fix**: Spot-check Step 9a, 9d, 9e, 13 example invocations to ensure parenthetical is present in every script path reference.
- **Alternative**: Create a linter rule to catch missing self-build parenthetical in `commands/devorch.md` (future follow-up).

## doc: `CACHE_FRESHNESS_MS` semantics unchanged by cache migration
- **Severity**: low
- **Detection**: `scripts/lib/constants.ts:8` — constant still represents "mtime threshold in ms for considering cached project-map.md fresh"; migration to global cache did not change its meaning (still 5 min), only the cache location.
- **Suggested fix**: Verify with code review that no consumer assumes mtime freshness applies per-worktree (it applies per-repo-hash, shared across all worktrees); no doc change needed if true.
- **Alternative**: Add a JSDoc clarification: "Applies to the global cache under `~/.claude/devorch-state/<repo-hash>/cache/`, shared by all worktrees of the same repo."

