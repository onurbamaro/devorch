# Plan: devorch Evolution v3 — Effort Guidance, Sizing, PostCompact Hook, Sparse Worktrees

<description>
Implement 4 improvements to devorch that leverage new Claude Code capabilities while
respecting the core philosophy (docs/PHILOSOPHY.md). Changes span command prompts,
scripts, and hooks.
</description>

<objective>
All 4 improvements are implemented and validated:
1. Effort guidance in all command/template prompts
2. Moderate sizing increases for 1M context era
3. PostCompact hook for state refresh
4. Sparse worktree support (manual + automatic)
</objective>

<classification>
Type: Enhancement
Complexity: Medium
Risk: Low
</classification>

<decisions>
Effort implementation approach → Prompt-based guidance instructions (not model tiers). Keep opus everywhere, add behavioral instructions per stage.
Task sizing increase → Moderate: CONTENT_THRESHOLD 25K→50K, max-lines 3000→5000, keep max 5 tasks/phase, allow larger tasks, change sizing rule from "prefer smaller phases" to "prefer fewer phases".
Sparse worktrees → Both manual (--sparse-paths flag) and automatic (derive from plan's relevant-files/new-files). Always include .devorch/, package.json, tsconfig.json, lock files as base paths.
Agent Teams → Deferred to next cycle (research preview, not stable enough).
</decisions>

<problem-statement>
devorch was designed for a 200K context world. With 1M context now available per builder,
the sizing rules are overly conservative, effort is uniform across stages with different
reasoning needs, there's no recovery from context compaction, and worktree setup checks
out entire repos unnecessarily.
</problem-statement>

<solution-approach>
Phase 1 addresses prompt-level changes (effort guidance + sizing rules) across all command
files and scripts. Phase 2 addresses infrastructure (PostCompact hook + sparse worktrees)
which requires new files and script modifications. talk.md is touched in both phases —
phase 1 for effort/sizing, phase 2 for sparse path derivation — so phases must be sequential.
</solution-approach>

<relevant-files>
- `commands/talk.md` — add effort guidance for exploration/planning, update sizing rules, add sparse path derivation
- `commands/build.md` — add effort guidance for coordination/review
- `commands/fix.md` — add effort guidance for investigation/review
- `templates/build-phase.md` — add effort guidance for builder deployment
- `agents/devorch-builder.md` — add effort guidance for implementation/fix-loop
- `scripts/init-phase.ts` — increase CONTENT_THRESHOLD from 25K to 50K
- `scripts/manage-cache.ts` — increase default max-lines from 3000 to 5000
- `scripts/setup-worktree.ts` — add --sparse-paths support
- `hooks/post-edit-lint.ts` — reference for hook pattern
- `install.ts` — register PostCompact hook

<new-files>
- `hooks/post-compact-state-refresh.ts` — PostCompact hook that re-reads state.md + plan title
</new-files>
</relevant-files>

<phase1 name="Effort Guidance and Sizing Updates">
<goal>Add reasoning depth guidance to all command/template prompts and increase context sizing limits for the 1M era.</goal>

<tasks>
#### 1. Add effort guidance to talk.md and update sizing rules
- **ID**: effort-sizing-talk
- **Assigned To**: builder-talk
- In `commands/talk.md`, add effort guidance instructions:
  - Step 2 (Explore agents): add instruction "Focus on information gathering. Be concise in summaries — report findings, not reasoning process. Prioritize breadth over depth."
  - Step 6 (Design solution): add instruction "Think deeply. Consider alternatives, edge cases, and long-term implications. This is where reasoning depth matters most."
- Update sizing rules section (currently lines 240-245):
  - Change "Max **5 tasks** per phase" to "Max **5 tasks** per phase. Tasks can span multiple related files when the changes are cohesive."
  - Change "Prefer more smaller phases over fewer large ones" to "Prefer fewer phases with well-scoped tasks. Each builder now has ample context (1M tokens) — use it by including more relevant explore-cache and conventions per task."
  - Add: "Include ALL relevant explore-cache sections for each task, not just the minimum. Builders benefit from broader context when it's fresh and focused."

#### 2. Add effort guidance to build.md
- **ID**: effort-build
- **Assigned To**: builder-build
- In `commands/build.md`, add effort guidance:
  - Step 2 (phase dispatch): add instruction to the phase Task prompt: "Coordinate efficiently. Focus on dispatching tasks and monitoring completion. Avoid deep analysis — that's the builders' job."
  - Step 3b (review agents): add instruction to reviewer prompts: "Analyze deeply. Look for subtle bugs, security issues, and edge cases that builders might miss. Thoroughness matters more than speed here."
  - Step 3c (fix-level builders): add instruction: "Debug thoroughly. Understand root cause before fixing. These are issues that reviewers caught — reason carefully about why they were missed."

#### 3. Add effort guidance to build-phase.md and devorch-builder.md
- **ID**: effort-builders
- **Assigned To**: builder-phase
- In `templates/build-phase.md`, add to builder prompt construction (around line 19-23):
  - Add to each builder's prompt: "Execute focused implementation. You have a clear spec — prioritize writing correct code over extensive exploration. If you encounter unexpected complexity, use Explore agents rather than reasoning through unknowns."
  - For the fix loop section: "When fixing errors, reason deeply about root cause. Don't just patch symptoms — understand why the error occurred and fix the underlying issue."
- In `agents/devorch-builder.md`, add to workflow section:
  - After line 19 (Explore guidance): "Implementation focus: write code efficiently with the spec provided. Save deep reasoning for debugging and error fixing."

#### 4. Add effort guidance to fix.md
- **ID**: effort-fix
- **Assigned To**: builder-fix
- In `commands/fix.md`, add effort guidance:
  - Step 3 (investigation): add to Explore agent prompts: "Investigate systematically. Test your hypothesis against the code — don't speculate. Report concrete evidence."
  - Step 6 (verification): add to review agent prompts: "Review thoroughly. This is a targeted fix — verify it doesn't introduce regressions or miss related issues. Check edge cases."

#### 5. Increase context sizing limits
- **ID**: increase-limits
- **Assigned To**: builder-limits
- In `scripts/init-phase.ts`: change `const CONTENT_THRESHOLD = 25000;` to `const CONTENT_THRESHOLD = 50000;`
- In `scripts/manage-cache.ts`: change `const maxLines = args["max-lines"] || 3000;` to `const maxLines = args["max-lines"] || 5000;`

#### 6. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify all effort guidance additions are consistent across files
- Verify CONTENT_THRESHOLD and max-lines values are updated
- Run validation commands
</tasks>

<execution>
**Wave 1** (parallel): effort-sizing-talk, effort-build, effort-builders, effort-fix, increase-limits
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] talk.md has effort guidance for exploration and planning stages
- [ ] talk.md sizing rules updated for 1M context era
- [ ] build.md has effort guidance for coordination, review, and fix-level stages
- [ ] build-phase.md and devorch-builder.md have effort guidance for implementation and fix-loop
- [ ] fix.md has effort guidance for investigation and review stages
- [ ] CONTENT_THRESHOLD is 50000 in init-phase.ts
- [ ] Default max-lines is 5000 in manage-cache.ts
</criteria>

<validation>
- `bun scripts/init-phase.ts --help 2>&1 || true` — script loads without error
- `bun scripts/manage-cache.ts --help 2>&1 || true` — script loads without error
</validation>

<handoff>
All command prompts now include stage-appropriate effort guidance. Sizing limits increased
(CONTENT_THRESHOLD 50K, cache 5000 lines). talk.md will be modified again in phase 2
for sparse path derivation — changes are in different sections (sizing rules vs worktree setup).
</handoff>
</phase1>

<phase2 name="PostCompact Hook and Sparse Worktrees">
<goal>Add PostCompact state recovery hook and sparse-checkout support to worktree setup with automatic path derivation in planning.</goal>

<tasks>
#### 1. Create PostCompact state refresh hook
- **ID**: postcompact-hook
- **Assigned To**: builder-hook
- Create `hooks/post-compact-state-refresh.ts` following the pattern from `hooks/post-edit-lint.ts`:
  - Read stdin JSON (PostCompact event provides `compact_summary`)
  - Find active devorch state: walk up from cwd looking for `.devorch/state.md`
  - If not found, check `.worktrees/*/` subdirectories for `.devorch/state.md`
  - Read `state.md` content (phase progress, handoff summary)
  - Read plan title from `.devorch/plans/current.md` using regex (don't import — keep hook self-contained)
  - Output to stdout a structured reminder:
    ```
    [devorch state refresh] Plan: <title> | Phase <N>/<total> complete | Last handoff: <summary>
    ```
  - Exit 0 always (never block on state refresh failure — wrap everything in try-catch)

#### 2. Register PostCompact hook in install.ts
- **ID**: register-hook
- **Assigned To**: builder-install
- In `install.ts`:
  - Add `post-compact-state-refresh.ts` to the list of hook files to copy to ~/.claude/hooks/
  - Register in settings.json hooks section as a global PostCompact hook:
    ```json
    {
      "hooks": {
        "PostCompact": [{
          "type": "command",
          "command": "bun <CLAUDE_HOME>/hooks/post-compact-state-refresh.ts"
        }]
      }
    }
    ```
  - Ensure existing hooks (statusLine, post-edit-lint, etc.) are preserved during settings merge

#### 3. Add sparse-checkout support to setup-worktree.ts
- **ID**: sparse-worktree
- **Assigned To**: builder-sparse
- In `scripts/setup-worktree.ts`:
  - Add `--sparse-paths` argument (optional string, comma-separated directory list)
  - After worktree creation (after `git worktree add`), if --sparse-paths is provided:
    1. Run `git -C <worktreePath> sparse-checkout init --cone`
    2. Parse comma-separated paths into array
    3. Always prepend base paths: `.devorch` plus any root config files that exist (package.json, tsconfig.json, lock files)
    4. Run `git -C <worktreePath> sparse-checkout set <all-paths-space-separated>`
  - Add `sparsePaths: string[]` to the JSON output when sparse-checkout is used
  - For satellites: apply same sparse-checkout if --sparse-paths is provided
  - If sparse-checkout commands fail, log warning to stderr and continue (non-blocking)

#### 4. Add automatic sparse path derivation to talk.md
- **ID**: auto-sparse-talk
- **Assigned To**: builder-auto-sparse
- In `commands/talk.md`, Step 7 (Create plan), point 2 (Setup worktree):
  - Before calling setup-worktree.ts, add logic to derive sparse paths from the plan:
    1. Extract unique top-level directories from `<relevant-files>` and `<new-files>` entries
    2. Join as comma-separated string
  - Pass `--sparse-paths <derived-paths>` to the setup-worktree.ts call
  - Add note: "Sparse-checkout is an optional optimization. If the plan references more than 10 top-level directories, skip --sparse-paths to use full checkout."
  - Update both setup-worktree.ts call examples (with and without --secondary) to show --sparse-paths usage

#### 5. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verify PostCompact hook script runs without error on empty input
- Verify setup-worktree.ts accepts --sparse-paths
- Verify install.ts registers the new hook
- Run validation commands
</tasks>

<execution>
**Wave 1** (parallel): postcompact-hook, sparse-worktree
**Wave 2** (after wave 1): register-hook, auto-sparse-talk
**Wave 3** (validation): validate-phase-2
</execution>

<criteria>
- [ ] PostCompact hook exists at hooks/post-compact-state-refresh.ts
- [ ] PostCompact hook reads state.md and plan title, outputs structured reminder
- [ ] PostCompact hook never exits with error (always exit 0)
- [ ] install.ts copies PostCompact hook and registers in settings.json
- [ ] setup-worktree.ts accepts --sparse-paths argument
- [ ] Sparse-checkout includes .devorch and root config files as base paths
- [ ] JSON output includes sparsePaths when sparse-checkout is used
- [ ] talk.md derives sparse paths from plan and passes to setup-worktree.ts
- [ ] Sparse path derivation has fallback (skip if >10 dirs or derivation fails)
</criteria>

<validation>
- `echo '{}' | bun hooks/post-compact-state-refresh.ts; echo "exit: $?"` — exits 0 on empty input
- `bun scripts/setup-worktree.ts --help 2>&1 || true` — script loads without error
</validation>
</phase2>
