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

2. **Assess complexity** — checklist binário, sem julgamento subjetivo:

   Todas as condições abaixo devem ser **YES** para prosseguir como quick fix:
   - [ ] Modifica **3 arquivos ou menos**?
   - [ ] **Zero** mudanças de interface, API pública, ou assinaturas de tipo exportadas?
   - [ ] **Zero** novas dependências (npm, imports de módulos novos)?
   - [ ] Existe código (teste ou produção) que já cobre o comportamento afetado?
   - [ ] A mudança é **mecanicamente verificável** (lint + typecheck passam)?

   Se **QUALQUER** item é **NO** → **PARE. Recomende make-plan.**

   NÃO use julgamento subjetivo. NÃO racionalize "mas nesse caso é diferente...". A frase "mas nesse caso" é um red flag — significa que a mudança NÃO é trivial.

   Quando recomendar make-plan, gere um prompt pronto:
   ```
   Esta task precisa de planejamento. Use: /devorch:make-plan [task description]
   Motivo: [qual item do checklist falhou]
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
- All user-facing text in Portuguese must use correct pt-BR accentuation and grammar (e.g., "não", "ação", "é", "código", "será"). Never write Portuguese without proper accents.
- Complexity is determined by the checklist above, not by intuition. Do not override the checklist with subjective judgment.
