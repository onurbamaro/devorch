# Explore Cache
Generated: 2026-02-07T00:00:00Z

## README and project metadata
- README.md exists (258 lines), comprehensive but technical/dry tone
- Covers: install, workflows, how it works, commands reference, project structure, context isolation, parallelism, commit conventions, Agent Teams
- No LICENSE file anywhere in project root
- package.json has no `license` field
- package.json: name=devorch, version=1.0.0, description="Developer Orchestrator for Claude Code"
- 13 commands, 2 agents, 8 scripts, 2 hooks
- Some YAML descriptions in Portuguese (builder/validator agents)
- install.ts uses directory iteration (not explicit file lists) — copies commands/, agents/, scripts/, hooks/

## Project structure
- commands/ — 13 .md files (build, build-all, check-implementation, debug, explore-deep, make-plan, make-tests, map-codebase, new-idea, plan-tests, quick, resume, review)
- agents/ — 2 .md files (devorch-builder, devorch-validator)
- scripts/ — 8 .ts files (check-agent-teams, check-project, extract-criteria, extract-phase, hash-plan, map-conventions, map-project, validate-plan)
- hooks/ — 2 files (devorch-statusline.cjs, post-edit-lint.ts)
- Root: install.ts, uninstall.ts, package.json, README.md, tsconfig.json, bun.lock
