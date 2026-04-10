# Plan: devorch build refinements — orchestrator fixes and builder feedback

<description>
Fix 4 script-level bugs discovered during the "foundation-backend" build (timeout, conventions duplication, archive loss, stash conflicts) and add structured Build Report output to builders for devorch flow improvement feedback.
</description>

<objective>
All 4 script bugs are fixed (check-project timeout, init-phase conventions dedup, archive-plan target-root, stash/worktree exclusions), and builders emit a structured Build Report that the orchestrator parses and aggregates in the final verification report.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: medium
</classification>

<decisions>
- Timeout fix: QUICK_TIMEOUT_MS 10s → 30s + fix inner SIGKILL timer leak (cancel handle)
- Conventions dedup: campo único no root JSON + conventionSectionsByTask com section names (string[])
- Archive fix: archive-plan.ts gets --target-root flag, copies to main repo
- Worktree removal: --force only in build.md and talk.md post-merge cleanup (not in setup-worktree.ts)
- Stash exclusion: pathspec negation `-- ':!.devorch/'` in build.md and talk.md
- Build Report format: markdown headers fixos (## Build Report), fields: Spec gaps, Model fit, Convention gaps, Cache gaps, Flow friction, Warnings
- Build Report parsing: orchestrator extracts and aggregates in final report only (not auto-fed to feedback.md)
- Build Report scope: focus on devorch flow improvement data, not code metrics
- Archive enrichment: archive only the plan, no state.md or report snapshot
- Flow friction field: captures info the devorch flow should have provided but didn't (missing info, confusing prompts, self-discovered patterns)
</decisions>

<problem-statement>
The "foundation-backend" build (2 phases, 9 tasks, 48 files) completed successfully but revealed 4 script bugs and a lack of structured feedback from builders. The orchestrator can't distinguish timeouts from real errors, conventions inflate output by 5x, archives are lost when worktrees are removed, and stash conflicts on .devorch/ files. Builders return only a 3-line summary — no visibility into difficulties, model fit, or spec gaps.
</problem-statement>

<solution-approach>
Fix scripts directly (check-project, init-phase, archive-plan) and update orchestrator commands (build.md, talk.md) for stash exclusion, worktree --force, conventions filtering, and Build Report parsing. Add Build Report section to both builder agent definitions. All changes are backward-compatible — new flags are optional, new output fields are additive.

Alternative considered: 2 phases separating scripts from .md files. Rejected because no runtime dependencies exist — wave ordering within 1 phase handles the format dependencies.
</solution-approach>

<relevant-files>
- `scripts/check-project.ts` — QUICK_TIMEOUT_MS constant, timeout kill mechanism, SIGKILL timer
- `scripts/init-phase.ts` — conventionsByTask duplication, filterConventionsForTask, output JSON structure
- `scripts/archive-plan.ts` — archive destination logic, --target-root flag addition
- `scripts/lib/args.ts` — parseArgs utility for CLI flag parsing
- `agents/devorch-builder.md` — step 8 final output format
- `agents/devorch-builder-deep.md` — step 8 final output format (identical to builder)
- `commands/build.md` — stash flow, worktree removal, builder prompt assembly, final report
- `commands/talk.md` — inline path stash, conventions injection, worktree removal, archive call

<new-files>
</new-files>
</relevant-files>

<phase1 name="Script fixes and builder feedback">
<goal>Fix all 4 script bugs and add Build Report to builders and orchestrator commands</goal>

<spec>
<behavior name="check-quick-timeout">
  <precondition>QUICK_TIMEOUT_MS is 10_000, inner SIGKILL timer has no cancellable handle</precondition>
  <postcondition>QUICK_TIMEOUT_MS is 30_000, inner SIGKILL timer has a clearTimeout handle that is cancelled when process exits normally before timeout fires</postcondition>
</behavior>

<interface name="archive-target-root">
  <input>--target-root path (optional string, defaults to "" via parseArgs)</input>
  <output>Archive file written to target-root/.devorch/plans/archive/ when --target-root is provided and non-empty; otherwise current behavior (relative to plan file)</output>
  <error case="empty-target-root">When --target-root is "" or omitted, use existing logic (resolve archive dir relative to plan file directory). Explicit falsy check: if (args.targetRoot) before using as directory base.</error>
</interface>

<interface name="conventions-dedup">
  <input>CONVENTIONS.md content, task list with file references</input>
  <output>JSON with: "conventions" (string, full content at root level), "conventionSectionsByTask" (Record of taskId to string[] of section header names). Section names are the exact ## header text as they appear in CONVENTIONS.md (e.g., "## Naming", "## Patterns"). Empty array means no matching sections — orchestrator sends full conventions as fallback.</output>
  <error case="no-conventions">When conventions file doesn't exist or is empty, "conventions" is empty string and "conventionSectionsByTask" is omitted from output</error>
</interface>

<invariant>The content/contentFile markdown blob must NOT contain a "## Conventions" section — conventions are delivered only via the root "conventions" field and "conventionSectionsByTask"</invariant>

<behavior name="build-report-format">
  <precondition>Builder step 8 emits only a 3-line unstructured summary</precondition>
  <postcondition>Builder step 8 emits the 3-line summary FOLLOWED by a ## Build Report section with these fields (all present, value "none"/"adequate" when nothing to report): Spec gaps, Model fit, Convention gaps, Cache gaps, Flow friction, Warnings</postcondition>
</behavior>

<behavior name="build-report-parsing">
  <precondition>Orchestrator does not parse builder text output</precondition>
  <postcondition>Orchestrator extracts ## Build Report block from each builder's output using regex (## Build Report to next ## or end of text). Missing report = silently skipped. Non-"none"/"adequate" values are aggregated per-task in the final verification report under "### Builder Reports"</postcondition>
</behavior>

<behavior name="stash-exclusion">
  <precondition>git stash push stashes all tracked changes including .devorch/ files</precondition>
  <postcondition>git stash push uses pathspec negation: git stash push -m "devorch-pre-merge" -- ':!.devorch/' to exclude .devorch/ files from stash</postcondition>
</behavior>

<behavior name="worktree-force-remove">
  <precondition>git worktree remove without --force fails on dirty worktrees</precondition>
  <postcondition>Post-merge cleanup in build.md and talk.md uses git worktree remove --force</postcondition>
</behavior>

<behavior name="archive-call-update">
  <precondition>archive-plan.ts called without --target-root, archive lost in worktree</precondition>
  <postcondition>build.md and talk.md call archive-plan.ts with --target-root pointing to main repo root. Legacy migration call in talk.md does NOT use --target-root (plan is already in main repo).</postcondition>
</behavior>

<behavior name="conventions-filtering-orchestrator">
  <precondition>Orchestrator injects conventionsByTask[taskId] as pre-filtered string into builder prompt</precondition>
  <postcondition>Orchestrator reads "conventions" from init-phase JSON root, reads "conventionSectionsByTask[taskId]" for section names array. If array is empty, sends full conventions. Otherwise, splits conventions by ## headers, matches section names, extracts matching content, joins and injects into builder prompt.</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Script fixes: check-project timeout + archive-plan target-root
- **ID**: script-fixes
- **Assigned To**: builder-a
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: check-quick-timeout, archive-target-root
- Modify `scripts/check-project.ts`: change `QUICK_TIMEOUT_MS` from `10_000` to `30_000`
- In the timeout handler (lines 142-148): store inner SIGKILL setTimeout in a variable (e.g., `let killTimer`), and in the normal exit path after `clearTimeout(timeout)`, also `clearTimeout(killTimer)` — but only if killTimer was assigned (it's only assigned when the outer timeout fires, so guard with `if (killTimer)`)
- Modify `scripts/archive-plan.ts`: add `--target-root` string flag via the existing parseArgs pattern from `scripts/lib/args.ts`
- When `args.targetRoot` is truthy (non-empty string): compute `archiveDir = resolve(args.targetRoot, ".devorch/plans/archive")` instead of `resolve(planDir, "archive")`
- When `args.targetRoot` is falsy (empty or omitted): use existing logic unchanged
- Ensure `mkdirSync(archiveDir, { recursive: true })` works for both paths

#### 2. Conventions deduplication in init-phase
- **ID**: conventions-dedup
- **Assigned To**: builder-b
- **Model**: opus
- **Effort**: medium
- **Spec refs**: conventions-dedup
- Modify `scripts/init-phase.ts`:
- Change `conventionsByTask` to `conventionSectionsByTask` — instead of storing filtered convention text per task, store an array of section header names (e.g., `["## Naming", "## Patterns"]`)
- Modify `filterConventionsForTask` to return section names (string[]) instead of joined content string
- Add `conventions` field at root level of output JSON containing the full CONVENTIONS.md text (single copy)
- Remove the `## Conventions` section from the content/contentFile markdown blob (lines 600-605)
- Handle edge case: when conventions file doesn't exist, omit `conventions` field and `conventionSectionsByTask` from output
- Handle edge case: when `filterConventionsForTask` returns empty array for a task, that means no sections matched — orchestrator will send full conventions as fallback

#### 3. Build Report in builder agents
- **ID**: build-report
- **Assigned To**: builder-c
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: build-report-format
- Modify `agents/devorch-builder.md` step 8 (line 38): keep the existing 3-line summary instruction, then add instruction for the builder to append a `## Build Report` section after the summary
- The Build Report must contain ALL of these fields (present even when nothing to report — use "none" or "adequate"):
  - `Spec gaps`: was the spec insufficient? Missing edge cases or unclear requirements?
  - `Model fit`: was the assigned model/effort adequate? (e.g., "sonnet/medium was insufficient, needed deeper reasoning for X")
  - `Convention gaps`: patterns encountered not covered by CONVENTIONS.md?
  - `Cache gaps`: needed to explore something the explore-cache didn't have?
  - `Flow friction`: information missing from the prompt, confusing instructions, things self-discovered that should have been provided?
  - `Warnings`: out-of-scope issues detected but not fixed?
- Apply the exact same changes to `agents/devorch-builder-deep.md` (step 8 is at line 40)
- Do NOT modify any other steps in either file

#### 4. Build.md orchestrator updates
- **ID**: build-md-updates
- **Assigned To**: builder-d
- **Model**: opus
- **Effort**: high
- **Spec refs**: stash-exclusion, worktree-force-remove, archive-call-update, build-report-parsing, conventions-filtering-orchestrator
- Modify `commands/build.md` in these sections:
- **Stash exclusion** (section 3e / merge flow, stash push): change `git stash push -m "devorch-pre-merge"` to `git stash push -m "devorch-pre-merge" -- ':!.devorch/'` in ALL stash push occurrences (both with-satellites and without-satellites paths)
- **Worktree --force** (section 3e / cleanup, worktree remove): change `git worktree remove <path>` to `git worktree remove --force <path>` in ALL worktree remove occurrences
- **Archive call** (section 3d / post-merge cleanup): change `archive-plan.ts --plan <planPath>` to `archive-plan.ts --plan <planPath> --target-root <repoMainPath>`
- **Conventions filtering** (section 2b or equivalent, builder prompt assembly): update instructions to read `conventions` from init-phase JSON root and `conventionSectionsByTask[taskId]` for section names array. Add instruction: "If section names array is empty, send full conventions. Otherwise, split conventions by `## ` headers, match section names, extract content of matching sections, join and inject into builder prompt as 'Convention sections'."
- **Build Report parsing** (section 2c, after each wave completes): add instruction to extract `## Build Report` block from each completed builder's text output. Use regex: from `## Build Report` to next `##` header or end of text. If no `## Build Report` found, skip silently. Store parsed reports per task-id.
- **Build Report aggregation** (section 3d, final verification report): add a `### Builder Reports` section that lists each task-id's report fields, but ONLY fields with non-"none"/non-"adequate" values. If all builders reported only "none"/"adequate", omit the section entirely.
- **Documentation fix**: update any reference to `conventionsByTask` in the Rules section (~line 465) to `conventionSectionsByTask`
- Do NOT modify sections unrelated to these changes

#### 5. Talk.md inline path updates
- **ID**: talk-md-updates
- **Assigned To**: builder-e
- **Model**: opus
- **Effort**: medium
- **Spec refs**: stash-exclusion, worktree-force-remove, archive-call-update, conventions-filtering-orchestrator
- Modify `commands/talk.md` inline path sections ONLY:
- **Stash exclusion** (step 10i, pre-flight stash): change `git stash push -m "devorch-pre-merge"` to `git stash push -m "devorch-pre-merge" -- ':!.devorch/'`
- **Worktree --force** (step 10i, worktree removal): change `git worktree remove <path>` to `git worktree remove --force <path>`
- **Archive call** (step 10i, cleanup): change `archive-plan.ts --plan <planPath>` to `archive-plan.ts --plan <planPath> --target-root <mainRoot>`
- **Conventions filtering** (step 8i-b, builder prompt assembly): update to read `conventions` from init-phase JSON root and `conventionSectionsByTask[taskId]` for section names. Same filtering logic as build.md: empty array = full conventions, otherwise match by ## headers.
- **Legacy migration** (step 1, legacy plan migration): do NOT add --target-root to the archive-plan call here — the legacy plan is already in the main repo, relative archiving works correctly
- **Scope restriction**: do NOT modify the WORKTREE PATH sections (steps 7-11), only INLINE PATH sections (steps 7i-10i) and step 1 context. Do NOT fix the duplicate `specsByTask` reference (existing bug, out of scope).
</tasks>

<execution>
**Wave 1** (parallel): script-fixes, conventions-dedup, build-report
**Wave 2** (after wave 1): build-md-updates, talk-md-updates
</execution>

<criteria>
- [ ] QUICK_TIMEOUT_MS is 30_000 and inner SIGKILL timer has clearTimeout handle
- [ ] archive-plan.ts accepts --target-root and writes to main repo when provided
- [ ] init-phase.ts outputs conventions at root and conventionSectionsByTask as string[]
- [ ] init-phase.ts content/contentFile blob has no ## Conventions section
- [ ] Both builder agents emit ## Build Report after 3-line summary
- [ ] build.md stash push uses ':!.devorch/' exclusion
- [ ] build.md worktree remove uses --force
- [ ] build.md parses and aggregates Build Reports in final report
- [ ] build.md uses conventionSectionsByTask for convention filtering
- [ ] build.md archive-plan call includes --target-root
- [ ] talk.md inline path has same stash, worktree, archive, conventions fixes
- [ ] talk.md legacy migration does NOT use --target-root
</criteria>
</phase1>
