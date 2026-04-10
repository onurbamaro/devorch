# Explore Cache
Generated: 2026-04-10T12:00:00Z

## Sparse Checkout & Worktree Setup

**Root cause**: `applySparseCheckout()` in `scripts/setup-worktree.ts:65-107` passes `ROOT_CONFIG_FILES` (file names like `package.json`) to `git sparse-checkout set` in cone mode. Cone mode only accepts directory paths, causing `fatal: 'package.json' is not a directory`.

**Partial activation**: `sparse-checkout init --cone` (line 70-78) succeeds first, setting `core.sparseCheckout=true`. When `set` fails (line 96-99), the function returns `null` without calling `git sparse-checkout disable`. The worktree is left with sparse-checkout active and a restrictive cone pattern.

**Fallback is cosmetic only**: `createSingleWorktree()` at lines 195-199 only pushes a warning string "sparse-checkout failed — using full checkout" but doesn't actually disable sparse-checkout.

**Design insight**: Cone mode's "parent pattern" rule already includes all root-level files when any subdirectory is listed. Since `.devorch` is always in `BASE_SPARSE_PATHS`, `ROOT_CONFIG_FILES` are redundant and cause the failure.

**Fix points**:
- Lines 96-99 (set failure path): add `sparse-checkout disable` before return
- Lines 103-106 (catch path): add `sparse-checkout disable` before return
- Line 66 (`ROOT_CONFIG_FILES`): can be removed entirely — cone mode handles root files automatically

## Merge Flow & Untracked Files

**build.md merge**: Section "4. Merge worktree" starting at line 315. Pre-flight stash at ~L385, dry-run merge at L387-393, actual merge at L395-398.

**talk.md merge**: Section "10i. Merge and cleanup" starting at line 470. Pre-flight stash at L476-480, dry-run merge at L482-487, actual merge at L489-493.

**Untracked gap**: Both files explicitly filter out `??` lines from stash. No detection of untracked files that would conflict with the merge branch. The dry-run failure is reported generically as "conflict" with no distinction between tracked merge conflicts and untracked file overwrites.

**Self-build gap**: No post-merge detection of devorch self-build. `install.ts` copies `commands/`, `agents/`, `scripts/`, `hooks/` to `~/.claude/`. After merge, installed copies in `~/.claude/` are stale. Post-merge cleanup (archive-plan etc.) runs with old scripts.

**Post-merge steps** (identical in both files): archive-plan, delete state.md, delete explore-cache, delete project-map.md, commit cleanup, remove worktree.

## Wave Type Parsing

**Bug location**: `scripts/init-phase.ts:305-308`

```typescript
let type: "parallel" | "sequential" = "parallel";
if (annotation === "sequential" || annotation.startsWith("after wave")) {
  type = "sequential";
}
```

`(after wave N)` is a dependency hint (wave ordering), not an intra-wave execution mode. The `|| annotation.startsWith("after wave")` clause incorrectly marks waves as sequential.

**Fix**: Remove `|| annotation.startsWith("after wave")` — only `annotation === "sequential"` should set type to sequential.

**Impact**: All consumers (build.md, build-phase-reference.md) currently treat parallel and sequential identically at execution time (launch all tasks in parallel regardless). The semantic fix is still correct for future use and clarity.
