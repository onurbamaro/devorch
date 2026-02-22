# Explore Cache
Generated: 2026-02-22T00:00:00Z

## User-Facing Text Analysis
- **commands/talk.md**: Mixed — descriptions pt-BR, discovery questions English, report messages mixed
- **commands/build.md**: Mostly English user messages; verification report (lines 112-132) mixed Portuguese/English
- **commands/fix.md**: Description pt-BR, escalation pt-BR, clean separation
- **commands/worktrees.md**: 100% English user messages — no language rule in Rules section
- **agents/devorch-builder.md**: Heavy Portuguese in instructions, has pt-BR grammar rule
- **templates/build-phase.md**: No language rule in Rules section
- **Scripts**: All stderr messages English; JSON output machine-readable (English keys)

## Instruction Structure and Rule Placement
- `/home/bruno/CLAUDE.md`: Global instructions, sparse — ideal for global language rules. No language rules currently.
- Existing pt-BR rules scattered across: build.md (line 364), fix.md (line 98), talk.md (line 364), devorch-builder.md (line 63)
- **Missing**: worktrees.md, build-phase.md — no language rule at all
- Rule placement pattern: "## Rules" section at end of each command/agent file
- Recommended: global rule in CLAUDE.md + standardized rule in each command file

## Risk Assessment and Edge Cases
- **Plan files**: Tags must stay English (parsers match them), content should be consistent language
- **AskUserQuestion**: Currently inconsistent — talk.md uses pt-BR options, worktrees.md uses English
- **Git commits**: Mixed history — recent commits have Portuguese, older ones English
- **Script output**: JSON (English) to stdout, errors (English) to stderr — orchestrator translates for user
- **explore-cache.md**: Internal cache, read by agents and orchestrators, not directly by users
- **CONVENTIONS.md**: Documents code patterns (inherently English-named), should stay English
- **Technical terms**: worktree, merge, branch, lint — should stay English even in Portuguese context
- **Critical gotcha**: Never translate XML tags or JSON field names — parsers break silently
