# Explore Cache
Generated: 2026-04-12T00:00:00Z

## Command Files Redundancy

### build.md ↔ talk.md (INLINE PATH) — ~200 lines overlap
The inline build path (steps 8i-10i) in talk.md re-implements build.md's phase loop. Key exact-copy blocks:
- Contract verifier template: 13 lines, character-for-character identical (build.md:124-135, talk.md:401-412)
- Builder retry procedure: 30 lines exact copy (build.md:148-161, talk.md:425-437)
- Build Report extraction: 5 lines exact copy
- Reviewer scaling table: 5 lines exact copy
- Final verification report format: 26 lines near-copy (build.md:323-346, talk.md:572-595)
- Builder dispatch (model/effort selection, convention injection, effort guidance, spec verification): ~20 lines near-copy
- Merge logic (stash, untracked guard, dry-run, merge, restore, cleanup): ~50 lines near-copy
- Cache management, phase summary calls: identical

### Format drift already happening
- Retry exhaustion report: `## Build Failure: <task title>` in build.md vs `### Task Failure: <task-id>` in talk.md
- Reviewer mandates: build.md has cross-phase integration detail, talk.md abbreviated
- Post-review check: build.md has --no-test flag, talk.md doesn't

### build.md internal duplication — ~40 lines
With-satellites vs without-satellites merge paths are near-identical. Only variable names differ (`<repoMainPath>` vs `<mainRoot>`). Sub-steps duplicated: untracked file guard, dry-run, merge, stash restore, self-build reinstall, fix migration journal, post-merge cleanup, worktree remove.

### Global rules in all 4 command files
- Language policy: 2 lines, exact copy in all 4 files
- "Do not narrate actions": 1 line, exact copy in all 4 files
- These are justified — each command runs in isolated context

### talk.md internal duplication — ~30 lines
Worktree path (steps 7-10) and inline path (steps 7i-10i) duplicate: setup worktree + write plan + copy conventions + commit plan.

## Builder Agent Overlap

### devorch-builder.md vs devorch-builder-deep.md — 60/75 lines identical
Only differences:
- Frontmatter: description, effort (medium vs high), color (cyan vs yellow)
- One paragraph in deep variant: "This agent variant runs at high effort..."
- Entire Workflow (9 steps), Multi-repo tasks, Red Flags table, Rules section: character-for-character identical

### Instructions duplicated in commands AND agents
- TaskUpdate "CRITICAL" reminder: in build.md, talk.md orchestrator prompt AND in both builder agent files step 8 + Red Flags
- Commit format: short form injected by orchestrator, detailed form in agent files (complementary, justified)
- Spec verification: identical text in build.md/talk.md injected to prompt, plus step 6 in agent files (different scope — task-specific vs general)
- Language policy: in all 5 files (all isolated contexts)

## Scripts Code Redundancy — ~310 lines total

### Critical (fully duplicated module code)
1. `collectFiles` + constants (CODE_EXTS, SAMPLE_DIRS, IGNORE): ~52 lines identical between map-conventions.ts and check-conventions-staleness.ts. Comment in check-conventions-staleness.ts admits: "identical logic to map-conventions.ts"
2. IGNORE set diverges silently: map-project.ts has 13 entries (includes .nuxt, .cache), map-conventions.ts/check-conventions-staleness.ts have 11 entries

### High (overlapping parsing not in lib/)
3. File-reference extraction regex duplicated: init-phase.ts (extractFileRefs function, ~12 lines) vs validate-plan.ts (inline, same regex)
4. Task section parsing: init-phase.ts parseTasks() ~38 lines vs validate-plan.ts ~40 lines reimplementing same logic
5. Wave parsing: init-phase.ts parseWaves() ~25 lines vs validate-plan.ts inline ~20 lines
6. Cache section splitting: same pattern repeated 4x within init-phase.ts (~55 lines). filterCache and filterCacheByRefs are functionally the same function

### Medium (boilerplate not leveraging lib/)
7. Arg parsing: 3 scripts bypass lib/args.ts with manual loops (~45 lines total). lib/args.ts lacks positional argument support
8. Package.json reading: 4 scripts independently open/parse/try-catch (~28 lines total)
9. Kebab-case conversion: archive-plan.ts toKebabCase vs init-phase.ts deriveWorktreeName (~6 lines)
10. Git worktree list parsing: list-worktrees.ts has two ~20-line functions that are 95% identical

### Low (dead exports)
11. extractFileEntries exported from lib/plan-parser.ts but never imported
12. filterCache in init-phase.ts is now redundant wrapper around filterCacheByRefs

### lib/ assessment
- lib/args.ts: used by 8/13 scripts, but 3 bypass it (missing positional arg support)
- lib/plan-parser.ts: well-used but missing extractFileRefs, parseTasks, parseWaves
- lib/fs-utils.ts: only 1 function (safeReadFile). Should also have: readPackageJson, toKebabCase, collectFiles
- lib/git-utils.ts: missing getWorktreePaths consolidation

## Elimination Assessment

### Can be eliminated (extractable to shared content)
1. Builder agent body → deep variant references base, adds only the effort paragraph
2. Contract verifier template → shared include or single source of truth
3. Final report format → shared include
4. Builder retry/failure procedure → shared include
5. build.md internal satellite/no-satellite merge → unified with conditional logic
6. Script duplications → move to lib/ modules

### Must stay duplicated (isolated context windows)
1. Language policy in each command file
2. "Do not narrate" in each command file
3. Full inline build path in talk.md (can't call build.md as sub-command)
4. TaskUpdate reminder (orchestrator injection is intentional reinforcement)
5. Commit format in fix.md (runs inline without builder sub-agents)
