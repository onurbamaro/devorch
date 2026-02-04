---
description: Map an existing project and generate devorch context files
model: opus
---

Map the current project's codebase and generate `.devorch/PROJECT.md` and `.devorch/CONVENTIONS.md`. These files are consumed by all other devorch commands — they must be accurate and complete.

## Workflow

### 1. Collect mechanical data

Run both scripts to get the baseline:

```
bun ~/.claude/devorch-scripts/map-project.ts
```
→ tech stack, folder structure, dependencies, scripts, git history

```
bun ~/.claude/devorch-scripts/map-conventions.ts
```
→ naming, exports, imports, style, test framework

If scripts fail (no Bun, etc.), do the equivalent analysis manually.

### 2. Investigate the codebase

The scripts give you surface data. Now investigate what a senior developer would look for on their first day. Go through each section below, reading actual files.

**Entrypoint and bootstrap flow**
- Find the main entrypoint (index.ts, main.ts, app.ts, server.ts, etc.)
- Trace the initialization order: what runs first? What depends on what?
- How does the app start in dev vs production?

**Configuration and environment**
- Find .env.example, .env.local, config files
- How are env vars loaded and validated? (dotenv, Zod, envalid, manual)
- What are the critical env vars? (DB connection, API keys, secrets)

**Architecture and key patterns**
- What architectural pattern is used? (MVC, clean architecture, event-driven, modular, etc.)
- How is code organized? Not just folders — what's the relationship between modules?
- Identify dominant patterns: dependency injection, repository pattern, factory, observer, pub/sub, middleware chain
- State management (frontend): Redux, Zustand, Context, signals, etc.

**Data layer**
- Database type and ORM/driver (Prisma, Drizzle, TypeORM, Mongoose, raw SQL, etc.)
- Where are schemas/models defined?
- Migrations system? Seeds?
- If no database, how is data persisted? (API, localStorage, files)

**API surface**
- Route definitions: where are they, how are they organized?
- REST, GraphQL, tRPC, WebSocket?
- Middleware stack (auth, validation, error handling, logging)

**Authentication and authorization**
- Auth method: JWT, session, OAuth, API keys, none?
- Where is auth logic? Middleware, guard, decorator?
- Role/permission system?

**External services**
- Third-party APIs consumed (payment, email, storage, etc.)
- Message queues, caches (Redis, RabbitMQ, etc.)
- How are API clients structured? (shared instance, factory, per-module)

**Error handling**
- Custom error classes? Error hierarchy?
- How are errors propagated? (throw, Result type, error codes)
- Global error handlers (middleware, process handlers)
- Error reporting (Sentry, logging service, etc.)

**Deployment**
- Dockerfile, docker-compose.yml
- CI/CD pipeline (.github/workflows, .gitlab-ci.yml, etc.)
- Hosting target (Vercel, AWS, CapRover, self-hosted, etc.)
- Build and start commands for production

**Active workarounds and constraints**
Only document things that affect how builders should write code:
- Workarounds a builder must preserve (e.g., "json-bigint used because IDs exceed MAX_SAFE_INTEGER")
- Coexisting patterns where the builder needs to know which to follow (e.g., "older modules throw, newer modules use Result type — follow Result type")
- Technical constraints that limit implementation choices (e.g., "Bull doesn't support X, so we do Y")
- Do NOT catalog TODOs, FIXMEs, or general debt — these are stale opinions, not actionable constraints

You don't need to cover every section exhaustively. Skip sections that don't apply (e.g., no database = skip data layer). But for sections that DO apply, read the actual files — don't guess from folder names.

### 3. Write PROJECT.md

Create `.devorch/PROJECT.md` combining script output + your investigation:

```markdown
# Project: <name>

<one-paragraph description: what it does, who it's for>

## Tech Stack
- Runtime: ...
- Framework: ...
- Database: ...
- Auth: ...
- (other relevant stack items)

## Architecture
<folder tree with annotations explaining the responsibility of each area>

## Entrypoint and Bootstrap
<initialization order, what connects to what at startup>

## How to Run
- Dev: `<command>`
- Build: `<command>`
- Start: `<command>`
- Docker: `<command>` (if applicable)

## Config / Env Vars
<critical env vars grouped by purpose, how they're validated>

## External Services
<APIs, queues, caches, third-party integrations>

## Data Model
<key entities and relationships, ORM/schema location>
(skip if no database)

## Auth
<auth method, where the logic lives>
(skip if no auth)

## Key Patterns
<architectural patterns, error handling approach, state management>

## Deployment
<how it's deployed, CI/CD, hosting>

## Important Decisions
<technical choices, trade-offs, migration status>

## Active Workarounds
<workarounds builders must preserve, and why they exist>
(skip if none found)
```

### 4. Write CONVENTIONS.md

Create `.devorch/CONVENTIONS.md` from script output + code reading:

```markdown
# Code Conventions

## Naming
<variables, functions, types, files, directories>

## Exports & Imports
<named vs default, import style, path conventions>

## Style
<semicolons, quotes, indentation, formatting tool>

## Error Handling
<how errors are created, propagated, caught>

## Logging
<logger setup, conventions for log messages>

## Patterns
<component structure, hooks patterns, service patterns — whatever is specific to this project>

## Testing
<framework, location, naming, coverage approach>

## Gotchas
<things a builder needs to know to avoid mistakes>
```

### 5. Report

Show what was generated, key findings, and suggest next steps:
- `/devorch:make-plan "description"` for planned work
- `/devorch:quick "description"` for small fixes

## Rules

- Do NOT use Task agents. Single-agent operation.
- Read actual files during investigation — don't write PROJECT.md from script output alone.
- Keep both files concise but complete. Prioritize accuracy over brevity.
- If scripts fail, do full manual analysis and warn the user.
