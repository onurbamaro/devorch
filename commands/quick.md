---
description: Quick fix or small change with auto-commit
argument-hint: <description of what to fix/change>
model: opus
---

Quick fix, small change, bug fix, or standalone task with auto-commit.

**Input**: $ARGUMENTS (description of what to fix/change)

## Steps

1. **Load context**:
   - Read `.devorch/CONVENTIONS.md` if it exists. This guides coding style and project conventions.
   - Run `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` to get the project tree and tech stack.

2. **Assess complexity**: Before implementing, evaluate the requested change:
   - **Straightforward**: Clear scope, well-defined outcome, you understand what to change → proceed
   - **Complex**: Requires architectural decisions, unclear how components interact, multiple subsystems involved, needs design before coding → **stop and recommend make-plan**

   When recommending make-plan, explain briefly why the task benefits from planning and generate a ready-to-use prompt:
   ```
   This task would benefit from /devorch:make-plan because [reason].
   Suggested prompt: /devorch:make-plan [task description]
   ```

3. **Implement** (straightforward changes only):
   - Use Explore agents (model: opus) to understand relevant code before changing it
   - Make the changes following project conventions
   - Run `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` to validate
   - If checks fail, fix the issues

4. **Auto-commit**: Commit with a conventional message:
   - Format: `feat|fix|refactor|chore|docs(scope): description`
   - Stage only the files you changed (not `git add .`)

5. **Report**: Show what was changed and the commit hash.

## Rules

- Do not narrate actions. Execute directly without preamble.
- No Task agents except Explore (for understanding code before changing it).
- Always validate with check-project.ts before committing.
- If conventions file exists, follow it strictly.
- The complexity assessment is about cognitive complexity, not file count. A simple rename across 10 files is straightforward; a 2-file change requiring new architecture is complex.
