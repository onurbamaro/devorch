---
description: Guided discovery for new projects
model: opus
---

Guided discovery for new projects. Generates devorch context files from Q&A.

## Steps

1. **Product discovery** — Ask adaptive questions about:
   - What the product does (elevator pitch)
   - Target audience
   - Essential MVP features (max 5)
   - What it does NOT do (scope boundaries)

   Ask 2-3 questions at a time using AskUserQuestion. Adapt based on answers — don't ask irrelevant questions.

2. **Technical discovery** — Ask about:
   - Language/runtime (suggest based on product type if user is unsure)
   - Framework (suggest 2-3 options with trade-offs)
   - Database (if needed)
   - Authentication (if needed)
   - Deployment target (Vercel, Fly, Railway, self-hosted, etc.)
   - Any existing code or repos to integrate with

   Again, 2-3 questions at a time, adaptive.

3. **Validate scope** — Summarize the MVP scope back to the user. Ask if anything is missing or should be removed. The goal is a milestone 1 that's achievable.

4. **Generate files** — Create `.devorch/` directory and write:

   - `.devorch/PROJECT.md`:
     ```markdown
     # [Project Name]

     ## Overview
     [What it does, who it's for]

     ## Tech Stack
     - Runtime: [x]
     - Framework: [x]
     - Database: [x]
     - Auth: [x]
     - Deploy: [x]

     ## MVP Scope
     - [Feature 1]
     - [Feature 2]
     - ...

     ## Out of Scope
     - [Thing 1]
     - [Thing 2]

     ## Key Decisions
     - [Decision 1: rationale]
     ```

   - `.devorch/ARCHITECTURE.md`:
     ```markdown
     # Architecture

     ## Structure
     [Proposed folder structure]

     ## Data Model
     [Key entities and relationships]

     ## API Design
     [Key endpoints or interfaces]

     ## Patterns
     [Architectural patterns chosen and why]
     ```

   - `.devorch/CONVENTIONS.md`:
     ```markdown
     # Conventions

     [Based on chosen stack — naming, file structure, patterns]
     ```

5. **Auto-commit** — Stage and commit the generated files:
   - Stage only the `.devorch/` files created (PROJECT.md, ARCHITECTURE.md, CONVENTIONS.md)
   - Format: `chore(devorch): initialize project context`

6. **Next step** — Generate a ready-to-use prompt for `/devorch:make-plan` that describes the first milestone. Show it to the user.

## Rules

- Do not narrate actions. Execute directly without preamble.
- This is PURE Q&A + file generation. No code, no building.
- Do NOT use Task agents. Single-agent conversation.
- Keep questions concise. Don't overwhelm the user.
- If the user is unsure about technical choices, make a recommendation with brief reasoning.
- MVP scope should be achievable in 3-5 build phases.
