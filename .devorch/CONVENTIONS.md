# Code Conventions

## Naming

- **Variables & constants**: camelCase (`cwd`, `pkgPath`, `filePath`)
- **Uppercase constants**: SCREAMING_SNAKE_CASE (`DEFAULT_TIMEOUT_MS`, `CODE_EXTS`, `IGNORE`)
- **Functions**: camelCase (`detectPkgScript()`, `runCheck()`, `findRoot()`)
- **Types/Interfaces**: PascalCase (`CheckResult`, `CheckDef`, `StackFile`, `PhaseBounds`)
- **Files**: kebab-case (`check-project.ts`, `extract-phase.ts`, `post-edit-lint.ts`)
- **Task IDs (in plans)**: kebab-case (`validate-phase-1`, `update-router`)

## Exports & Imports

- **No default exports** — scripts are imperative CLI tools that run top-level code on execution
- **Node.js stdlib via named destructuring**:
  ```ts
  import { existsSync, readFileSync, mkdirSync } from "fs";
  import { join, resolve, dirname, basename } from "path";
  ```
- **No third-party npm dependencies** — only Node.js stdlib and Bun APIs
- **Path manipulation**: Always use `path` module, never string concatenation

## Style

- **Semicolons**: Required, always present
- **Quotes**: Double quotes `"`
- **Indentation**: 2 spaces
- **Functions**: Arrow functions for short callbacks; regular `function` for named top-level functions
- **Comments**: Minimal — code is self-documenting via clear naming. Use `//` for clarifications only
- **Trailing commas**: Not used in single-line; used in multi-line arrays/objects

## Error Handling

- **Try-catch with silent fallback** for non-critical operations:
  ```ts
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    // ignore — use defaults
  }
  ```
- **Process exit strategy**:
  - `process.exit(0)` — success or graceful skip
  - `process.exit(1)` — validation error or lint failure
- **Error output**: `console.error()` for errors, `console.log()` for results
- **Stdin parsing**: Wrap in try-catch, exit 0 on parse failure (don't block agent)

## Patterns

### Script Structure
- 2-5 helper functions at top, then main logic below (imperative, top-level)
- Config-driven detection: define arrays of `CheckDef`-like objects, iterate with `.find()` or `.filter()`
- Regex-based parsing for XML tags and patterns (no XML parser libraries)
- Single-pass algorithms — process input once
- Scripts import shared utilities from `./lib/plan-parser`, `./lib/args`, `./lib/fs-utils`

### Async Execution
- `Bun.spawn()` for subprocess execution (not `child_process`)
- `Promise.all()` for parallel independent operations
- `async/await` at top level
- Stream reading: `new Response(proc.stdout).text()`

### Bun-Specific APIs
- `import.meta.dirname` for script directory
- `Bun.spawn()` / `Bun.spawnSync()` for subprocesses
- No Node.js `child_process` — always Bun APIs

### Windows Compatibility
- Backslash → forward slash conversion for paths in templates: `path.replaceAll("\\", "/")`
- Binary detection with `.cmd` extension: `isWin ? ".cmd" : ""`
- `$CLAUDE_HOME` in `.md` files uses forward slashes even on Windows

### Command File Structure (`.md`)
- YAML frontmatter: `description`, `model`, optional `argument-hint`, `hooks`, `disallowed-tools`
- Sections: brief intro → input/output → workflow (numbered steps) → rules
- References scripts via `bun $CLAUDE_HOME/devorch-scripts/<name>.ts`
- Agent references via `subagent_type=devorch-builder` or `subagent_type=devorch-validator`

### Script Output Format
- All scripts output **JSON** to stdout (not markdown)
- Orchestrator parses JSON for decisions
- Human-readable messages go to stderr

## Testing

- No test framework configured
- Validation via `check-project.ts` (lint, typecheck, build, test detection)
- Scripts are validated by running them — no unit test suite

## Active Workarounds

- **Linter detection order**: biome first, then eslint — preserve this priority
- **Timeout management**: 60s default, 120s for tests. Hard kill via `proc.kill()`, no graceful shutdown
- **Package manager detection**: Lock file sniffing (bun.lock → pnpm-lock → yarn.lock → npm). Fallback: `npm run`

## Gotchas

- `$CLAUDE_HOME` is a template variable replaced at install time — never hardcode paths in `.md` files
- Scripts assume Bun runtime — `node` won't work due to `Bun.spawn()` and `import.meta.dirname`
- `validate-plan.ts` returns `"block"` or `"continue"` — not boolean
- Builders must call `TaskUpdate(status: "completed")` as their absolute last action or the pipeline stalls
- Phase numbers must be sequential integers starting at 1 — no gaps
- State.md contains only the latest phase summary
