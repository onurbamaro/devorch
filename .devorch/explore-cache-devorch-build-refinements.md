# Explore Cache
Generated: 2026-04-10T12:00:00Z

## Scripts — check-project.ts, init-phase.ts, archive-plan.ts

### check-project.ts

**Timeout constants (lines 29-31):**
- `DEFAULT_TIMEOUT_MS = 60_000` (60s)
- `TEST_TIMEOUT_MS = 120_000` (120s)
- `QUICK_TIMEOUT_MS = 10_000` (10s) — used for ALL steps when `--quick` is active

**--quick mode (lines 14, 168-196):**
- `QUICK_CHECKS = new Set(["build", "typecheck"])` — lint and test are skipped
- Both build and typecheck get `QUICK_TIMEOUT_MS` (10s each)

**Timeout kill mechanism (lines 142-148):**
```ts
const timeout = setTimeout(() => {
  proc.kill();                              // SIGTERM first
  setTimeout(() => proc.kill(9), 5_000);   // SIGKILL after 5s grace
}, timeoutMs);
```
Inner SIGKILL timer has no cancellable handle — minor leak if outer timer fires.

**Stderr handling (lines 148-160):**
- Exit code 0 → "pass" (stderr never read)
- Exit code != 0 → reads stderr, takes last 3 lines, joins with space, truncates to 200 chars
- Format: `"fail: <last 3 lines>"` or `"fail: exit code N"` if stderr empty
- All checks run in parallel via `Promise.all`

### init-phase.ts

**Convention duplication:**
- Full conventions in `content` blob (lines 600-605)
- Per-task filtered conventions in `conventionsByTask` (lines 525-532)
- `extractExtensions()` finds file refs in task content → `filterConventionsForTask()` includes matching sections
- 5 tasks = 1 full copy + up to 5 filtered copies = ~6x conventions text
- `CONTENT_THRESHOLD = 50000` (line 15) — above this, writes to `.devorch/.phase-context.md`

**Output JSON structure:**
```json
{
  "phaseNumber", "phaseName", "totalPhases", "planTitle", "satellites",
  "waves", "tasks", "conventionsByTask", "cacheByTask", "specsByTask",
  "codeStructureByTask", "exploreQueries",
  "content" | "contentFile"
}
```

### archive-plan.ts

**Archive destination (lines 40-43):**
- Creates `archive/` relative to the plan file's directory
- Plan in worktree → archive written INSIDE worktree → deleted when worktree removed
- Archive is effectively LOST — never preserved in main repo

**Flow:** copy plan → archive dir, delete original, output JSON

### setup-worktree.ts

**Worktree removal (lines 39-58):**
- `git worktree remove` WITHOUT `--force` — fails on dirty/untracked files
- `git branch -d` (safe delete) — fails on unmerged commits
- Deliberate design: refuses force-delete to avoid data loss

## Builder Output & Build Orchestration

### agents/devorch-builder.md — Step 8 (line 38)

Current final output:
```
Your last text message must be a concise summary (max 3 lines): commit hash, files changed, and any warnings.
Nothing else — the phase agent receives this directly in its context.
```
- Unstructured prose, max 3 lines
- No defined delimiters, no structured format

### agents/devorch-builder-deep.md

Identical to devorch-builder.md except:
- Description: "reasoning profundo" vs normal
- Effort: high vs medium
- Color: yellow vs cyan
- Extra sentence about high effort variant
- Step 8 is IDENTICAL — same 3-line unstructured output

### commands/build.md — Builder result parsing

**No Build Report parsing exists.** The orchestrator checks:
1. `TaskList` — task marked `completed` or not
2. `git log` — commit matching task exists
3. On failure: last 50 lines of raw output captured for retry context

### commands/build.md — Stash flow (lines 320-328)

```bash
git -C <repoMainPath> status --porcelain
# Filter out ?? lines
git -C <repoMainPath> stash push -m "devorch-pre-merge"
```
- **No pathspec exclusions** — stashes ALL tracked changes including `.devorch/` files
- Applies to primary + all satellite repos

### commands/build.md — Worktree removal (lines 367-373, 410-414)

```bash
git -C <repoMainPath> worktree remove <worktreePath>
git -C <repoMainPath> branch -d <worktreeBranch>
```
- No `--force` flag
- Only happens after stash pop succeeds
