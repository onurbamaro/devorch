# Plan: Bilingual Language Rules

<description>
Configure Claude Code to use Portuguese (pt-BR) for all user-facing screen output and English (en-US) for code, git commits, internal files, and instructions. Add a global rule to ~/CLAUDE.md and standardize language rules across all devorch command files, agent files, and templates.
</description>

<objective>
All Claude Code user-facing output (questions, reports, summaries, progress messages) is in pt-BR. All code, git commits, internal files (plans, conventions, explore-cache), and Claude Code instructions are in en-US. Rules are consistent across all devorch files and globally enforced via ~/CLAUDE.md.
</objective>

<classification>
Type: Enhancement
Complexity: Simple
Risk: Low
</classification>

<decisions>
- Scope → Global rule in ~/CLAUDE.md affecting all projects
- Git commits → Always English (type(scope): description in en-US)
- Technical terms → Keep in English within Portuguese text (worktree, merge, branch, lint, build)
- Internal files → All in English (plans, CONVENTIONS.md, explore-cache.md). Only screen output is Portuguese.
</decisions>

<relevant-files>
- `/home/bruno/CLAUDE.md` — global instructions file, needs new language rules section
- `commands/talk.md` — has partial pt-BR rule (line 364), user-facing messages need pt-BR standardization
- `commands/build.md` — has partial pt-BR rule (line 364), user-facing messages mostly English need pt-BR
- `commands/fix.md` — has partial pt-BR rule (line 98), mostly correct already
- `commands/worktrees.md` — missing language rule entirely, all user messages in English
- `agents/devorch-builder.md` — has partial pt-BR rule (line 63), needs commit language clarification
- `templates/build-phase.md` — missing language rule entirely

<new-files>
(none)
</new-files>
</relevant-files>

<phase1 name="Global Rule and Devorch Standardization">
<goal>Add comprehensive bilingual language rule to ~/CLAUDE.md and standardize all devorch files with consistent language rules.</goal>

<tasks>
#### 1. Add Global Language Rules to ~/CLAUDE.md
- **ID**: add-global-language-rules
- **Assigned To**: builder-global
- Read `/home/bruno/CLAUDE.md`
- Add a new `## Language / Idioma` section after the existing content with these rules:
  - User-facing output (questions, reports, summaries, progress, errors explained to user): Portuguese pt-BR with correct accentuation
  - Code, variable names, comments, git commits, internal documentation: English en-US
  - Git commit format: `type(scope): description` always in English
  - Technical terms (worktree, merge, branch, lint, build, deploy) stay in English even within Portuguese sentences
  - Never write Portuguese without proper accents (não, ação, é, código, será, exploração)

#### 2. Standardize Language Rules in Devorch Command Files
- **ID**: standardize-devorch-commands
- **Assigned To**: builder-commands
- Update `commands/talk.md` Rules section: replace the existing partial pt-BR rule with the comprehensive bilingual rule (user-facing = pt-BR, code/commits/internal = en-US)
- Update `commands/build.md` Rules section: same replacement
- Update `commands/fix.md` Rules section: same replacement
- Add language rule to `commands/worktrees.md` Rules section (currently missing)
- Add language rule to `templates/build-phase.md` Rules section (currently missing)
- Update `agents/devorch-builder.md` Rules section: replace partial rule with comprehensive version including explicit commit language rule (en-US)
- The standardized rule text for all files:
  ```
  - **Language policy**: User-facing output (questions, reports, summaries, progress messages) in Portuguese pt-BR with correct accentuation (e.g., "não", "ação", "é", "código", "será"). Code, git commits, internal files, and technical documentation in English (en-US). Technical terms (worktree, merge, branch, lint, build) stay in English within Portuguese text.
  ```

#### 3. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify ~/CLAUDE.md has the new Language section
- Verify all 4 command files have the standardized language rule
- Verify agents/devorch-builder.md has the updated rule
- Verify templates/build-phase.md has the language rule
- Run `bun scripts/check-project.ts` to ensure no lint/typecheck errors
</tasks>

<execution>
**Wave 1** (parallel): add-global-language-rules, standardize-devorch-commands
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] ~/CLAUDE.md contains comprehensive bilingual language rules section
- [ ] All 4 command files (talk, build, fix, worktrees) have standardized language rule in Rules section
- [ ] agents/devorch-builder.md has updated language rule with commit language specification
- [ ] templates/build-phase.md has language rule in Rules section
- [ ] No lint or typecheck errors
</criteria>

<validation>
- `grep -l "Language policy" commands/*.md agents/*.md templates/*.md` — all devorch instruction files contain the rule
- `grep "Language" /home/bruno/CLAUDE.md` — global file contains language section
- `bun scripts/check-project.ts` — no lint/typecheck errors
</validation>
</phase1>
