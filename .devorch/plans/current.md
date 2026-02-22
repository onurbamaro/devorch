# Plan: Aggressive Review Fix Dispatch

<description>
Modify the adversarial review dispatch logic in build.md so that fix-level issues (well-defined, actionable, no design decisions needed) are fixed immediately inline or via builder agents, instead of being deferred as `/devorch:fix` commands. Only issues requiring planning/discussion (talk-level) are left as `/devorch:talk` commands.
</description>

<objective>
After a build completes, the adversarial review fixes all actionable issues immediately (trivial via Edit, fix-level via builder agents for 3+ files), only leaving `/devorch:talk` commands for issues requiring design decisions or architectural discussion.
</objective>

<classification>
Type: Enhancement
Complexity: Medium
Risk: Low
</classification>

<decisions>
- Retry limit for fix→check→fix cycle → 2 retries before escalating to /devorch:talk
- Multi-file fix execution → spawn devorch-builder via Task for fixes touching 3+ files; inline Edit for simpler fixes
- Report format → unified "Correções Automáticas" section (no trivial vs fix-level split)
- Command for pending issues → /devorch:talk (not /devorch:fix) since fix-level is already handled
</decisions>

<problem-statement>
The current adversarial review in build.md step 3c classifies findings as either "trivial" (fix inline) or "complex" (defer as /devorch:fix). This leaves many actionable, well-defined issues as deferred commands when they could be resolved immediately. The fix.md command already defines a FIX vs TALK classification that distinguishes between "obvious how, no design decisions" and "needs planning". This classification should be applied to the review dispatch so that only talk-level issues remain as commands.
</problem-statement>

<solution-approach>
Adopt the fix.md FIX/TALK classification in build.md step 3c. The new dispatch logic:

1. **Trivial** (1-2 files, self-evident fix): Edit inline directly — same as today
2. **Fix-level** (well-defined fix, obvious approach, but 3+ files): Launch a devorch-builder Task agent with the finding details and affected files
3. **Talk-level** (design decisions needed, multiple approaches, structural impact): Generate `/devorch:talk` command

Add a bounded retry loop (max 2) for the fix→check→fix cycle. After fixes, re-run check-project.ts. If still failing after 2 retries, escalate remaining issues to /devorch:talk.

Update the report template to show a unified "Correções Automáticas" section and change "Issues Pendentes" to reference /devorch:talk instead of /devorch:fix.

Alternative considered: expanding inline Edit for all fix-level issues. Rejected because multi-file fixes can consume excessive context in build.md's inline execution. Builder agents run in isolated context.
</solution-approach>

<relevant-files>
- `commands/build.md` — contains the adversarial review dispatch logic (step 3c) and report template (step 3d) that need modification

<new-files>
(none)
</new-files>
</relevant-files>

<phase1 name="Update Review Dispatch Logic">
<goal>Modify build.md step 3c to use FIX/TALK classification with builder agents for multi-file fixes, bounded retry loop, and updated report template.</goal>

<tasks>
#### 1. Rewrite Dispatch and Report in build.md
- **ID**: rewrite-dispatch-and-report
- **Assigned To**: builder-main
- Read `commands/build.md` fully
- Replace step 3c "Synthesize and dispatch" (lines 94-107) with the new three-tier classification:
  - **Trivial** (1-2 files, self-evident): fix directly with Edit tool. Examples: leftover TODO/FIXME, unused import, typo, formatting, missing semicolon
  - **Fix-level** (well-defined fix, obvious approach, no design decisions, but touches 3+ files OR requires non-trivial logic): launch a devorch-builder Task agent (`subagent_type="devorch-builder"`) as foreground call. The builder prompt includes: finding description with file:line evidence from reviewers, affected files list, CONVENTIONS.md, specific instruction to fix and commit. Examples: rename type across files, add missing error handling to multiple endpoints, fix consistent pattern violation across modules
  - **Talk-level** (requires design decisions, multiple valid approaches, architectural impact, or scope too large to fix without planning): do NOT fix. Generate a ready-to-paste prompt: `/devorch:talk <detailed description including: what's wrong, which files are affected, what the reviewers found, why it needs planning>`
- Add bounded retry loop after all fixes: re-run `check-project.ts`, if failures remain classify new findings and fix (up to 2 total retry cycles). After 2 retries, escalate remaining failures to `/devorch:talk`
- Commit with `fix(check): <description>` after each fix round (not after each individual fix)
- Fix-level builder agents commit their own changes (standard builder behavior)
- Update step 3d report template:
  - "Correções Automáticas" section: unified, lists all fixed issues (trivial + fix-level) with count. Format: `<N issues corrigidos inline, M via builder agents> (ou "Nenhum")`
  - "Issues Pendentes" section: change `/devorch:fix` references to `/devorch:talk`. Format: `<prompts /devorch:talk gerados> (ou "Nenhum")`
  - Keep the rest of the report template unchanged
- Update the Rules section (line 252) to reflect the new behavior: "Auto-fix trivial and fix-level findings. Only escalate talk-level issues with `/devorch:talk` prompt."

#### 2. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify `commands/build.md` has the new three-tier classification (trivial, fix-level, talk-level)
- Verify builder agent launch pattern for fix-level issues uses `subagent_type="devorch-builder"`
- Verify retry loop is bounded at 2
- Verify report template references `/devorch:talk` (not `/devorch:fix`)
- Verify no references to `/devorch:fix` remain in step 3c or 3d
- Run: `bun /home/bruno/.claude/devorch-scripts/validate-plan.ts --plan .devorch/plans/current.md`
</tasks>

<execution>
**Wave 1** (sequential): rewrite-dispatch-and-report
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] Step 3c has three-tier classification: trivial (Edit inline), fix-level (builder agent), talk-level (/devorch:talk)
- [ ] Fix-level builder launches use `subagent_type="devorch-builder"` as foreground Task
- [ ] Retry loop bounded at 2 cycles with escalation to /devorch:talk
- [ ] Report template shows unified "Correções Automáticas" and "/devorch:talk" for pending issues
- [ ] No remaining references to `/devorch:fix` in steps 3c or 3d
- [ ] Rules section updated to reflect new dispatch behavior
</criteria>

<validation>
- `grep -c "devorch:fix" commands/build.md` — should return 0 (no references in dispatch/report sections)
- `grep -c "devorch:talk" commands/build.md` — should return at least 2 (dispatch + report)
- `grep -c "devorch-builder" commands/build.md` — should return at least 1 (builder launch for fix-level)
</validation>
</phase1>
