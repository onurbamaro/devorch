Quick fix or small change with auto-commit.

**Input**: $ARGUMENTS (description of what to fix/change)

## Steps

1. **Load context**: Read `.devorch/PROJECT.md` and `.devorch/CONVENTIONS.md` if they exist. These guide coding style and project conventions.

2. **Assess complexity**: Evaluate the requested change:
   - **Small** (1-3 files, clear scope): proceed with direct implementation
   - **Large** (4+ files, unclear scope, needs design): tell the user this is too big for /quick and generate a prompt for `/devorch:make-plan`

3. **Implement** (small changes only):
   - Make the changes following project conventions
   - Run `bun ~/.claude/devorch-scripts/check-project.ts` to validate
   - If checks fail, fix the issues

4. **Auto-commit**: Commit with a conventional message:
   - Format: `feat|fix|refactor|chore|docs(scope): description`
   - Stage only the files you changed (not `git add .`)

5. **Report**: Show what was changed and the commit hash.

## Rules

- This is for SMALL, focused changes only.
- No Task agents. Direct implementation by the orchestrator.
- Always validate with check-project.ts before committing.
- If conventions file exists, follow it strictly.
- If the change touches more than 3 files, stop and redirect to make-plan.
