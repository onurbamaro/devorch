# Plan: CLI-First Orchestration — Full Deterministic Coverage

<description>
Replace LLM-driven file operations in devorch with deterministic CLI scripts. Create 9 new Bun scripts covering: compound phase init, state mutations, wave extraction, explore-cache management, plan archival, commit formatting, validation execution with correct working directories, artifact verification, and build summary generation. Update all command/template files to use the new scripts. Add --auto flag to make-plan that chains directly into build. Remove extract-phase.ts (subsumed by init-phase.ts).
</description>

<objective>
Every deterministic operation in the devorch pipeline (state writing, wave parsing, cache management, plan archival, commit formatting, validation execution, artifact verification) is handled by a Bun CLI script — not by LLM reasoning. The --auto flag on make-plan chains planning directly into build without user intervention. After a successful build, .devorch/build-summary.md contains a compact reference for follow-up sessions.
</objective>

<classification>
Type: enhancement
Complexity: complex
Risk: medium
</classification>

<decisions>
- Auto-advance flow → Direto sem pausa. make-plan --auto valida plano, commita, lança build como Task agent (contexto limpo) imediatamente.
- extract-phase.ts → Removido. init-phase.ts substitui completamente. Só era usado em build-phase.md.
- verify-build.ts scope → Só <new-files>. Checa existência + conteúdo real (não stub). Arquivos existentes modificados já são cobertos pelo check-project.ts.
- Build summary → Gerar .devorch/build-summary.md ao final de cada build bem-sucedido. Compacto, referenciável em sessão limpa.
- Plan format → Mantém XML. Mais robusto para geração LLM (sem indentation sensitivity).
- Model overrides → Não implementar. Manter tudo opus.
- Runtime → Todos scripts em Bun.
- config.json → .devorch/config.json para persistir flags (auto_advance). Lido/escrito por scripts.
</decisions>

<problem-statement>
O devorch já tem 8 scripts cobrindo validação de plano, extração de fase, checagem de projeto, etc. Mas diversas operações determinísticas ainda são executadas pelo LLM: escrita de state.md, parsing de waves, invalidação de explore-cache, arquivamento de planos, formatação de commits, execução de validações (com bug de working directory em projetos multi-repo), e verificação de artefatos. Cada uma dessas é um ponto de falha — o LLM pode formatar errado, pular um passo, ou executar no diretório errado. Além disso, o fluxo make-plan → build requer intervenção manual (/clear + /devorch:build), e após o build não há arquivo de referência para sessões de follow-up.
</problem-statement>

<solution-approach>
**Approach**: Criar 9 novos scripts Bun (TypeScript) seguindo as mesmas convenções dos 8 existentes (self-contained, zero deps npm, JSON output, Node.js stdlib + Bun APIs). Atualizar os 4 arquivos de orquestração (build-phase.md, make-plan.md, check-implementation.md, build.md) para substituir lógica LLM por chamadas de script. Adicionar --auto flag ao make-plan com persistência em .devorch/config.json.

**Script roster (9 new)**:
1. `init-phase.ts` — compound init retornando fase + handoff + conventions + state + explore-cache filtrado. Subsume extract-phase.ts.
2. `update-state.ts` — escrita determinística de state.md + append em state-history.md.
3. `extract-waves.ts` — parseia bloco execution, retorna JSON com waves e tasks estruturados.
4. `verify-build.ts` — checa new-files: existência + conteúdo real (não stub/placeholder).
5. `run-validation.ts` — executa validation commands no working directory correto, extraído das tasks do plano.
6. `manage-cache.ts` — invalida seções do explore-cache por arquivos alterados (git diff) + trim a 3000 linhas.
7. `archive-plan.ts` — move current.md para plans/archive/ com timestamp.
8. `format-commit.ts` — gera mensagem de commit padronizada para fase.
9. `generate-summary.ts` — gera .devorch/build-summary.md compacto para referência em follow-up.

**Integration changes (4 files)**:
- `build-phase.md` — usa init-phase, extract-waves, update-state, manage-cache, format-commit, run-validation
- `make-plan.md` — usa archive-plan, adiciona --auto
- `check-implementation.md` — usa verify-build
- `build.md` — chama generate-summary após check-implementation PASS

**Alternatives considered:**
- YAML para planos: rejeitado — XML mais robusto para geração LLM (sem indentation sensitivity).
- Shared utility module: rejeitado — convenção existente é scripts self-contained, e Bun não precisa de bundle.
- init-phase incluir wave parsing: rejeitado — mantém scripts focados, e extract-waves é útil standalone.
</solution-approach>

<relevant-files>
- `scripts/extract-phase.ts` — será deletado (substituído por init-phase.ts)
- `commands/build.md` — adicionar chamada a generate-summary.ts após check-implementation
- `commands/make-plan.md` — substituir lógica de arquivamento por archive-plan.ts, adicionar --auto flag
- `commands/check-implementation.md` — adicionar chamada a verify-build.ts
- `templates/build-phase.md` — reescrever para usar init-phase, extract-waves, update-state, manage-cache, format-commit, run-validation
- `commands/quick.md` — referência de padrões de argumento

<new-files>
- `scripts/init-phase.ts` — compound init para build-phase (substitui extract-phase.ts)
- `scripts/update-state.ts` — mutações determinísticas de state.md e state-history.md
- `scripts/extract-waves.ts` — parser de waves do bloco execution
- `scripts/verify-build.ts` — verificação de artefatos (new-files existem e não são stubs)
- `scripts/run-validation.ts` — execução de validation commands com working directory correto
- `scripts/manage-cache.ts` — invalidação e trim do explore-cache
- `scripts/archive-plan.ts` — arquivamento de current.md
- `scripts/format-commit.ts` — geração de mensagem de commit de fase
- `scripts/generate-summary.ts` — geração de build-summary.md
</new-files>
</relevant-files>

<phase1 name="Core CLI Scripts">
<goal>Create the 3 foundational scripts that build-phase.md depends on most: compound init, state mutations, and wave extraction.</goal>

<tasks>
#### 1. Create init-phase.ts
- **ID**: create-init-phase
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Create `scripts/init-phase.ts` following existing script conventions (JSDoc header, parseArgs, JSON output, Node.js stdlib + Bun APIs only)
- **Usage**: `bun init-phase.ts --plan <path> --phase <N>`
- **Reads**: plan file, `.devorch/CONVENTIONS.md`, `.devorch/state.md`, `.devorch/explore-cache.md`
- **Logic**:
  - Parse plan file using same regex patterns as extract-phase.ts: detect `<phaseN name="...">...</phaseN>` tags, extract PhaseBounds
  - Extract plan header: everything before first `<phase1` tag (includes description, objective, classification, decisions, solution-approach, relevant-files)
  - Extract target phase N content (between `<phaseN>` and `</phaseN>`)
  - Extract `<handoff>...</handoff>` from phase N-1 (if N > 1)
  - Extract plan-level fields via regex: `<objective>...</objective>`, `<decisions>...</decisions>`, `<solution-approach>...</solution-approach>`
  - Read `.devorch/CONVENTIONS.md` (empty string if missing)
  - Read `.devorch/state.md` (empty string if missing)
  - Read `.devorch/explore-cache.md` and filter: for each `## <section>` block, check if any file path from the phase's `<tasks>` content appears in that block. Include only matching sections. Empty string if no cache or no matches.
  - Compute total output size. If `content` field would exceed 25000 chars, write to `.devorch/.phase-context.md` and set `contentFile` in JSON instead.
- **Output JSON** (stdout):
  ```
  {
    "phaseNumber": N,
    "phaseName": "...",
    "totalPhases": M,
    "planTitle": "...",
    "content": "# Phase N: <name>\n\n## Objective\n...\n\n## Decisions\n...\n\n## Solution Approach\n...\n\n## Phase Content\n<full phase markdown>\n\n## Previous Handoff\n...\n\n## Conventions\n...\n\n## Current State\n...\n\n## Explore Cache (filtered)\n..."
  }
  ```
  Or if content exceeds 25000 chars:
  ```
  {
    "phaseNumber": N,
    "phaseName": "...",
    "totalPhases": M,
    "planTitle": "...",
    "contentFile": ".devorch/.phase-context.md"
  }
  ```
- **Error handling**: missing --plan or --phase → stderr + exit 1. Unreadable plan → stderr + exit 1. Phase not found → stderr listing available phases + exit 1. Missing optional files (conventions, state, cache) → empty string, no error.

#### 2. Create update-state.ts
- **ID**: create-update-state
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Create `scripts/update-state.ts` following existing conventions
- **Usage**: `bun update-state.ts --plan <path> --phase <N> --status <status> --summary <text>`
- **Status values**: `ready for phase N+1`, `completed`, or custom string
- **Logic**:
  - Read plan file, extract plan title from first `# Plan: <title>` heading
  - Read current `.devorch/state.md` if it exists
  - If state.md has a `## Phase` section: extract that section (from `## Phase` to end of file) and append it to `.devorch/state-history.md` (create if needed, append with `\n\n` separator)
  - Write new `.devorch/state.md`:
    ```
    # devorch State
    - Plan: <plan title>
    - Last completed phase: <N>
    - Status: <status>

    ## Phase <N> Summary
    <summary text>
    ```
  - The --summary text may contain newlines (passed as quoted string). Preserve them as-is.
- **Output JSON**: `{"stateFile": ".devorch/state.md", "historyAppended": <boolean>, "planTitle": "<title>", "phase": <N>}`
- **Error handling**: missing required args → stderr + exit 1. Unreadable plan → stderr + exit 1. Missing state.md on first run → skip history append, write fresh state.

#### 3. Create extract-waves.ts
- **ID**: create-extract-waves
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Create `scripts/extract-waves.ts` following existing conventions
- **Usage**: `bun extract-waves.ts --plan <path> --phase <N>`
- **Logic**:
  - Parse plan file, find phase N content (reuse PhaseBounds pattern)
  - Extract `<execution>...</execution>` block from the phase
  - Parse each `**Wave N**` line: extract wave number, task IDs (comma-separated after the colon), and type from annotations — `(parallel)` → `"parallel"`, `(validation)` → `"validation"`, `(after wave N)` or `(sequential)` → `"sequential"`. Default to `"parallel"` if no annotation.
  - Extract `<tasks>...</tasks>` block from the phase
  - For each task (delimited by `#### N.` headers): extract `**ID**:` value, `**Assigned To**:` value, task title (text after `#### N. `), and full task content (everything from the `#### N.` header to the next `#### ` header or end of tasks block)
  - Cross-reference: for each wave, verify all task IDs exist in the tasks map. Warn to stderr if a wave references a non-existent task ID.
- **Output JSON**:
  ```
  {
    "waves": [
      {"wave": 1, "taskIds": ["task-a", "task-b"], "type": "parallel"},
      {"wave": 2, "taskIds": ["task-c"], "type": "sequential"},
      {"wave": 3, "taskIds": ["validate-phase-1"], "type": "validation"}
    ],
    "tasks": {
      "task-a": {"id": "task-a", "assignedTo": "builder", "title": "Task Title", "content": "full markdown content"},
      "task-b": {"id": "task-b", "assignedTo": "builder", "title": "Task Title", "content": "full markdown content"},
      "validate-phase-1": {"id": "validate-phase-1", "assignedTo": "validator", "title": "Validate Phase", "content": "..."}
    }
  }
  ```
- **Error handling**: missing args → stderr + exit 1. Phase not found → stderr + exit 1. No execution block → stderr + exit 1.

#### 4. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify init-phase.ts exists with correct parseArgs (--plan, --phase), reads all 4 optional files, outputs JSON with content or contentFile, handles large output threshold, filters explore-cache by phase file paths
- Verify update-state.ts exists with correct parseArgs (--plan, --phase, --status, --summary), appends old phase section to state-history.md before overwriting, outputs correct state.md format matching the pattern `Last completed phase: N`
- Verify extract-waves.ts exists with correct parseArgs (--plan, --phase), parses `**Wave N**` lines with type detection, extracts task metadata (ID, Assigned To, title, content), cross-references wave task IDs against tasks map
- Verify all 3 scripts follow conventions: JSDoc header, named fs imports, no npm deps, Bun APIs for subprocesses, JSON output via console.log, exit 1 for bad args
- Run `bun scripts/init-phase.ts 2>&1 || true` — should show usage (exits 1 with usage message)
- Run `bun scripts/update-state.ts 2>&1 || true` — should show usage
- Run `bun scripts/extract-waves.ts 2>&1 || true` — should show usage
</tasks>

<execution>
**Wave 1** (parallel): create-init-phase, create-update-state, create-extract-waves
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] `init-phase.ts` exists, accepts --plan and --phase, outputs JSON with phase content + conventions + state + filtered explore-cache
- [ ] `init-phase.ts` handles large output (>25000 chars) by writing to .devorch/.phase-context.md
- [ ] `init-phase.ts` filters explore-cache sections by phase file paths (not full dump)
- [ ] `update-state.ts` exists, accepts --plan --phase --status --summary, writes state.md deterministically
- [ ] `update-state.ts` appends old phase summary to state-history.md before overwriting state.md
- [ ] `update-state.ts` output format matches `Last completed phase: N` pattern (parseable by build.md)
- [ ] `extract-waves.ts` exists, accepts --plan --phase, returns structured waves and tasks JSON
- [ ] `extract-waves.ts` extracts task ID, assignedTo, title, and full content for each task
- [ ] All 3 scripts follow conventions: JSDoc, named fs imports, no npm deps, JSON stdout, exit 1 for bad args
</criteria>

<validation>
- `bun scripts/init-phase.ts 2>&1 | head -1` — shows usage error (missing args)
- `bun scripts/update-state.ts 2>&1 | head -1` — shows usage error
- `bun scripts/extract-waves.ts 2>&1 | head -1` — shows usage error
- `grep -r "parseArgs" scripts/init-phase.ts` — function exists
- `grep -r "parseArgs" scripts/update-state.ts` — function exists
- `grep -r "parseArgs" scripts/extract-waves.ts` — function exists
- `grep -r "console.log" scripts/init-phase.ts` — JSON output exists
- `grep -r "state-history" scripts/update-state.ts` — history append logic exists
- `grep -r "Wave" scripts/extract-waves.ts` — wave parsing logic exists
</validation>

<handoff>
Three core scripts created: init-phase.ts (compound phase context — plan + conventions + state + filtered cache), update-state.ts (deterministic state.md + history append), extract-waves.ts (structured wave/task JSON). All follow existing conventions (self-contained, JSON output, Bun runtime). Next phase creates the 5 utility scripts for cache management, plan archival, commit formatting, artifact verification, and validation execution.
</handoff>
</phase1>

<phase2 name="Utility CLI Scripts">
<goal>Create the remaining 5 utility scripts: verify-build, run-validation, manage-cache, archive-plan, and format-commit.</goal>

<tasks>
#### 1. Create verify-build.ts
- **ID**: create-verify-build
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Create `scripts/verify-build.ts` following existing conventions
- **Usage**: `bun verify-build.ts --plan <path>`
- **Logic**:
  - Parse plan file, extract `<new-files>...</new-files>` block from `<relevant-files>`
  - For each file listed (format: `- \`path/to/file\` — description`): extract path and description
  - For each file, check 3 things:
    1. **Exists**: `existsSync(path)` — if not, record `{path, status: "missing"}`
    2. **Not empty**: file has more than 0 bytes
    3. **Not a stub**: read file content, check for stub indicators:
       - Contains `TODO` or `FIXME` or `PLACEHOLDER` (case-insensitive) as standalone words
       - Contains `throw new Error("not implemented")` or `throw new Error("TODO")`
       - Contains `return null` or `return undefined` as the only statement in a function body
       - File has fewer than 3 non-empty, non-comment lines (likely a placeholder)
       - If any stub indicator found: record `{path, status: "stub", indicators: [...]}`
  - Resolve file paths relative to process.cwd()
- **Output JSON**:
  ```
  {
    "totalFiles": N,
    "passed": M,
    "failed": K,
    "files": [
      {"path": "...", "status": "ok", "description": "..."},
      {"path": "...", "status": "missing", "description": "..."},
      {"path": "...", "status": "stub", "description": "...", "indicators": ["TODO found on line 5"]}
    ]
  }
  ```
- **Error handling**: missing --plan → stderr + exit 1. No new-files block → output `{"totalFiles": 0, "passed": 0, "failed": 0, "files": []}` (not an error).

#### 2. Create run-validation.ts
- **ID**: create-run-validation
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Create `scripts/run-validation.ts` following existing conventions
- **Usage**: `bun run-validation.ts --plan <path> --phase <N>`
- **Logic**:
  - Parse plan file, find phase N content
  - Extract `<validation>...</validation>` block — parse each line matching `` /^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/ `` (same pattern as extract-criteria.ts) to get command + description
  - Extract all unique `Working directory:` values from the phase's `<tasks>` block (scan for lines matching `/Working directory:\s*\`([^`]+)\`/` or `/Working directory:\s*(.+)/`)
  - If only 1 unique working directory: use it for all commands
  - If multiple working directories: for each validation command, determine the best directory by checking which working directory contains the paths referenced in the command (scan command string for path fragments like `src/...`). If ambiguous, try each directory and use the first where the command exits 0.
  - If no working directories found in tasks: use process.cwd()
  - Execute each command via `Bun.spawn` with `cwd` set to the determined directory, timeout 30s
  - Capture stdout+stderr, exit code
- **Output JSON**:
  ```
  {
    "totalCommands": N,
    "passed": M,
    "failed": K,
    "results": [
      {"command": "...", "description": "...", "cwd": "...", "status": "pass"},
      {"command": "...", "description": "...", "cwd": "...", "status": "fail", "output": "last 5 lines of stderr"}
    ]
  }
  ```
- **Error handling**: missing args → stderr + exit 1. No validation block → `{"totalCommands": 0, "passed": 0, "failed": 0, "results": []}`. Command timeout → status `"timeout"`.

#### 3. Create manage-cache.ts
- **ID**: create-manage-cache
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- Create `scripts/manage-cache.ts` following existing conventions
- **Usage**: `bun manage-cache.ts --action <invalidate|trim|invalidate,trim> [--max-lines 3000]`
- **Actions**:
  - **invalidate**: Run `git diff --name-only HEAD~1..HEAD` via `Bun.spawnSync` to get changed files. Read `.devorch/explore-cache.md`. For each `## <section>` block (delimited by `## ` headers), check if any changed file path appears in that block's content. If yes, remove that section. Write updated cache back.
  - **trim**: Read `.devorch/explore-cache.md`. If line count exceeds `--max-lines` (default 3000), remove oldest sections (from top, after the `# Explore Cache` header and `Generated:` line) until under the limit. Write updated cache back.
  - Both actions can be combined: `--action invalidate,trim` runs invalidate first, then trim.
- **Output JSON**: `{"action": "invalidate,trim", "sectionsRemoved": N, "sectionsRemaining": M, "linesAfter": L}`
- **Error handling**: missing --action → stderr + exit 1. No explore-cache.md → output `{"action": "...", "sectionsRemoved": 0, "sectionsRemaining": 0, "linesAfter": 0}`. Git not available → skip invalidate, only trim if requested.

#### 4. Create archive-plan.ts and format-commit.ts
- **ID**: create-archive-and-format
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- **archive-plan.ts**:
  - **Usage**: `bun archive-plan.ts --plan <path>`
  - Read plan file, extract plan name from first `# Plan: <name>` heading
  - Generate archive filename: `<YYYY-MM-DD>-<kebab-case-name>.md` (kebab-case the plan name: lowercase, spaces/special chars to hyphens, collapse multiple hyphens)
  - Create `.devorch/plans/archive/` directory if needed (via `mkdirSync` with `{recursive: true}`)
  - Copy plan file to `.devorch/plans/archive/<filename>`
  - Delete original plan file
  - **Output JSON**: `{"archived": true, "from": "<original path>", "to": "<archive path>", "planName": "<name>"}`
  - **Error handling**: missing --plan → stderr + exit 1. Plan file not found → stderr + exit 1.
- **format-commit.ts**:
  - **Usage**: `bun format-commit.ts --plan <path> --phase <N>`
  - Read plan file, find phase N, extract `<goal>...</goal>` content
  - Truncate goal to 50 chars if longer (append `...`)
  - Format: `phase(<N>): <truncated goal>`
  - **Output JSON**: `{"message": "phase(2): Replace debounce pipeline with queue+cache...", "phase": 2, "goal": "<full goal>"}`
  - **Error handling**: missing args → stderr + exit 1. Phase not found → stderr + exit 1.

#### 5. Validate Phase
- **ID**: validate-phase-2
- **Assigned To**: validator
- Verify verify-build.ts: parses new-files, checks existence + stub detection (TODO, FIXME, empty function bodies, throw not-implemented), outputs structured JSON
- Verify run-validation.ts: parses validation commands, extracts working directories from tasks, executes commands with correct cwd, handles multi-directory and timeout cases
- Verify manage-cache.ts: runs git diff for invalidation, parses `## ` sections, removes stale sections, trims to max-lines, handles combined actions
- Verify archive-plan.ts: generates correct filename (date + kebab-case), creates archive dir, moves file
- Verify format-commit.ts: extracts phase goal, truncates to 50 chars, formats as `phase(N): <goal>`
- All scripts follow conventions: JSDoc, named fs imports, no npm deps, JSON stdout, exit 1 for bad args
- Run `bun scripts/verify-build.ts 2>&1 || true` — shows usage error
- Run `bun scripts/run-validation.ts 2>&1 || true` — shows usage error
- Run `bun scripts/manage-cache.ts 2>&1 || true` — shows usage error
- Run `bun scripts/archive-plan.ts 2>&1 || true` — shows usage error
- Run `bun scripts/format-commit.ts 2>&1 || true` — shows usage error
</tasks>

<execution>
**Wave 1** (parallel): create-verify-build, create-run-validation, create-manage-cache, create-archive-and-format
**Wave 2** (validation): validate-phase-2
</execution>

<criteria>
- [ ] `verify-build.ts` exists, parses new-files, checks existence + stub detection (TODO/FIXME/empty body/throw not-implemented), outputs JSON with per-file status
- [ ] `run-validation.ts` exists, parses validation commands, extracts working directories from phase tasks, executes each command with correct cwd via Bun.spawn
- [ ] `run-validation.ts` handles multiple working directories (tries each, picks correct one based on path presence in command)
- [ ] `manage-cache.ts` exists, invalidate action uses git diff to find changed files and removes matching cache sections, trim action enforces max-lines limit
- [ ] `archive-plan.ts` exists, generates `<date>-<kebab-name>.md` filename, creates archive dir, moves plan file
- [ ] `format-commit.ts` exists, extracts phase goal, truncates to 50 chars, formats as `phase(N): <goal>`
- [ ] All 5 scripts follow conventions: JSDoc, named fs imports, no npm deps, JSON stdout, exit 1 for bad args
</criteria>

<validation>
- `bun scripts/verify-build.ts 2>&1 | head -1` — shows usage error (missing args)
- `bun scripts/run-validation.ts 2>&1 | head -1` — shows usage error
- `bun scripts/manage-cache.ts 2>&1 | head -1` — shows usage error
- `bun scripts/archive-plan.ts 2>&1 | head -1` — shows usage error
- `bun scripts/format-commit.ts 2>&1 | head -1` — shows usage error
- `grep -r "existsSync" scripts/verify-build.ts` — file existence check present
- `grep -r "TODO\|FIXME\|stub" scripts/verify-build.ts` — stub detection present
- `grep -r "Bun.spawn" scripts/run-validation.ts` — command execution present
- `grep -r "git diff" scripts/manage-cache.ts` — git diff for invalidation present
- `grep -r "archive" scripts/archive-plan.ts` — archive directory logic present
- `grep -r "phase(" scripts/format-commit.ts` — commit format present
</validation>

<handoff>
Five utility scripts created: verify-build.ts (artifact verification for new-files), run-validation.ts (executes validation commands with correct working directory), manage-cache.ts (explore-cache invalidation via git diff + trim), archive-plan.ts (plan archival with date+kebab naming), format-commit.ts (deterministic phase commit messages). Combined with Phase 1's core scripts, all 8 utility scripts are ready. Next: create generate-summary.ts and integrate all scripts into the 4 orchestration files (build-phase.md, make-plan.md, check-implementation.md, build.md). Also delete extract-phase.ts (replaced by init-phase.ts).
</handoff>
</phase2>

<phase3 name="Integration + Build Summary">
<goal>Create generate-summary.ts, integrate all 9 scripts into the orchestration files, add --auto flag to make-plan, and delete extract-phase.ts.</goal>

<tasks>
#### 1. Create generate-summary.ts and Update build.md
- **ID**: create-summary-update-build
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- **Create `scripts/generate-summary.ts`**:
  - **Usage**: `bun generate-summary.ts --plan <path>`
  - **Reads**: plan file, `.devorch/state-history.md`, `git log --oneline -20` via Bun.spawnSync
  - **Logic**:
    - Extract from plan: title (from `# Plan: <title>`), objective (from `<objective>`), decisions (from `<decisions>`), relevant-files block (parse `### <project-name> (\`<path>\`)` headers for project names + paths, and `- \`<path>\` — <description>` lines for individual files), new-files block (same line format), phase names and goals (from `<phaseN name="...">` and `<goal>`)
    - Read state-history.md: split by `## Phase` headers to get per-phase summaries
    - Run `git log --oneline -20` via Bun.spawnSync. Filter commits matching `phase(` or `feat(` or `fix(` or `refactor(` or `chore(devorch): plan` patterns.
    - Count files per project: from relevant-files + new-files, group by project header path
  - **Writes**: `.devorch/build-summary.md`:
    ```
    # Build Summary: <plan title>
    Completed: <ISO timestamp>

    ## Objective
    <plan objective, verbatim>

    ## Key Decisions
    <plan decisions, verbatim>

    ## Projects
    - `<path-1>` (<project-name-1>) — <N> files
    - `<path-2>` (<project-name-2>) — <M> files

    ## New Files
    - `<path>` — <description>

    ## Modified Files
    - `<path>` — <description>

    ## Phase History
    ### Phase 1: <name> — <goal>
    <summary from state-history.md>

    ### Phase 2: <name> — <goal>
    <summary from state-history.md>

    ## Commits
    <filtered git log entries>
    ```
  - **Output JSON**: `{"summaryFile": ".devorch/build-summary.md", "phasesCompleted": N, "projectCount": M}`
  - **Error handling**: missing --plan → stderr + exit 1. Missing state-history.md → Phase History section shows "(no phase history available)". Git failure → Commits section shows "(git not available)".
- **Update `commands/build.md`**: After the existing check-implementation step, if the verdict is PASS, add these steps:
  - Run `bun $CLAUDE_HOME/devorch-scripts/generate-summary.ts --plan .devorch/plans/current.md`
  - Stage `.devorch/build-summary.md` and commit: `chore(devorch): build summary — <plan name>`
  - Show the user: "Build summary saved to `.devorch/build-summary.md`"

#### 2. Update build-phase.md and Delete extract-phase.ts
- **ID**: update-build-phase
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- This is the largest integration. Replace 6 LLM-driven operations with script calls in `templates/build-phase.md`:
- **Replace Step 1 (extract-phase call)** with init-phase.ts:
  - Old: `bun $CLAUDE_HOME/devorch-scripts/extract-phase.ts --plan .devorch/plans/current.md --phase N`
  - New: `bun $CLAUDE_HOME/devorch-scripts/init-phase.ts --plan .devorch/plans/current.md --phase N`
  - Parse JSON output. If `contentFile` field is present, read that file. Otherwise use `content` field directly as the phase context.
  - Remove the separate Read calls for CONVENTIONS.md, explore-cache.md, and state.md — init-phase.ts includes all of these in its output.
- **Replace manual wave parsing (Step 4)** with extract-waves.ts:
  - Old: Agent reads execution block, interprets wave structure, decides which tasks to launch in parallel
  - New: `bun $CLAUDE_HOME/devorch-scripts/extract-waves.ts --plan .devorch/plans/current.md --phase N`
  - Use the structured `waves` array to determine launch order. Use `tasks` map to get each task's content for builder prompts.
  - For each wave: launch all taskIds as parallel Task calls (for `"parallel"` and `"sequential"` type waves with builders). For `"validation"` type: launch as devorch-validator.
- **Replace manual state writing (Step 8)** with update-state.ts:
  - Old: Agent manually writes state.md format and appends to state-history.md
  - New: `bun $CLAUDE_HOME/devorch-scripts/update-state.ts --plan .devorch/plans/current.md --phase N --status "ready for phase $((N+1))" --summary "<concise phase summary>"`
- **Replace manual cache invalidation (Step 7)** with manage-cache.ts:
  - Old: Agent runs git diff, reads explore-cache, manually identifies stale sections, edits file, checks line count
  - New: `bun $CLAUDE_HOME/devorch-scripts/manage-cache.ts --action invalidate,trim --max-lines 3000`
- **Replace manual commit message (Step 6)** with format-commit.ts:
  - Old: Agent writes commit message `phase(N): <goal summary>`
  - New: `bun $CLAUDE_HOME/devorch-scripts/format-commit.ts --plan .devorch/plans/current.md --phase N` — use the `message` field from JSON output as the git commit message.
- **Add run-validation.ts call (Step 5)** before validator deployment:
  - New step: `bun $CLAUDE_HOME/devorch-scripts/run-validation.ts --plan .devorch/plans/current.md --phase N`
  - If all commands pass: proceed to deploy validator for criteria checking only
  - If any command fails: include the failure output in the validator's prompt context so it can assess whether it's a real problem
  - The validator no longer runs validation commands directly — it focuses solely on acceptance criteria verification by reading code
- **Delete `scripts/extract-phase.ts`**: Remove this file from the repository. It is fully replaced by init-phase.ts. Ensure no references to `extract-phase` remain in any file.

#### 3. Update make-plan.md
- **ID**: update-make-plan
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- **Replace manual archival** with archive-plan.ts:
  - In the "handle existing plan" logic (when current.md exists and state shows completed): replace the manual file move with `bun $CLAUDE_HOME/devorch-scripts/archive-plan.ts --plan .devorch/plans/current.md`
  - Keep the existing behavior: auto-archive if complete, ask user if in-progress
- **Add --auto flag support**:
  - At the start of the command, detect `--auto` in `$ARGUMENTS`: use a simple string check `$ARGUMENTS.includes("--auto")` or equivalent instruction
  - Strip `--auto` from the description passed to the planning workflow (so it doesn't appear as part of what to build)
  - After plan validation + commit (end of step 11), check the --auto flag:
    - **If --auto**: Write `.devorch/config.json` with `{"auto_advance": true}`. Read `$CLAUDE_HOME/commands/devorch/build.md`. Strip YAML frontmatter (remove everything between the first `---` pair, inclusive). Launch as `Task(subagent_type="general-purpose", prompt=<stripped build.md content>)`. After the Task returns, update `.devorch/config.json` to `{"auto_advance": false}`.
    - **If NOT --auto**: Keep existing behavior — show classification, phase overview, instruct `/clear` then `/devorch:build`

#### 4. Update check-implementation.md
- **ID**: update-check-impl
- **Assigned To**: builder
- Working directory: `C:\Users\bruno\Documents\Dev\devorch`
- **Add verify-build.ts call** to the verification step:
  - After extract-criteria.ts call and alongside the check-project.ts background call, add:
    - `bun $CLAUDE_HOME/devorch-scripts/verify-build.ts --plan .devorch/plans/current.md`
    - Parse JSON output. If any files have status `"missing"` or `"stub"`: include these as known issues in the verification context passed to Explore agents
    - If `failed > 0`: the overall verdict cannot be PASS unless all missing/stub files are explicitly accounted for (e.g., intentionally removed or renamed during implementation)
  - This runs in parallel with check-project.ts (both as concurrent Bash calls)

#### 5. Validate Phase
- **ID**: validate-phase-3
- **Assigned To**: validator
- Verify generate-summary.ts exists with correct parseArgs, reads plan + state-history + git log, writes build-summary.md with all required sections
- Verify build.md calls generate-summary.ts after check-implementation PASS, commits the summary
- Verify build-phase.md:
  - Uses init-phase.ts instead of extract-phase.ts (no references to extract-phase remain)
  - Uses extract-waves.ts for wave/task parsing
  - Uses update-state.ts for state.md writing (no manual state.md formatting)
  - Uses manage-cache.ts for cache invalidation+trim (no manual cache editing)
  - Uses format-commit.ts for commit message generation
  - Uses run-validation.ts before validator deployment
- Verify make-plan.md:
  - Uses archive-plan.ts for plan archival
  - Detects --auto in $ARGUMENTS, strips it from description
  - With --auto: writes config.json, reads and strips build.md frontmatter, launches build as Task, cleans up config
  - Without --auto: shows /clear + /devorch:build instructions (unchanged behavior)
- Verify check-implementation.md uses verify-build.ts alongside check-project.ts
- Verify extract-phase.ts is deleted from scripts/
- `grep -r "extract-phase" scripts/ commands/ templates/ agents/` must return zero matches
</tasks>

<execution>
**Wave 1** (parallel): create-summary-update-build, update-build-phase, update-make-plan, update-check-impl
**Wave 2** (validation): validate-phase-3
</execution>

<criteria>
- [ ] `generate-summary.ts` exists, reads plan + state-history + git log, writes compact .devorch/build-summary.md
- [ ] build-summary.md includes: Objective, Key Decisions, Projects (with paths), New Files, Modified Files, Phase History, Commits
- [ ] `build.md` calls generate-summary.ts after check-implementation PASS, commits the summary file
- [ ] `build-phase.md` uses init-phase.ts (not extract-phase.ts) for compound context loading
- [ ] `build-phase.md` uses extract-waves.ts for structured wave/task parsing (no manual wave interpretation)
- [ ] `build-phase.md` uses update-state.ts for state.md writing (no manual state.md formatting)
- [ ] `build-phase.md` uses manage-cache.ts for cache invalidation and trimming
- [ ] `build-phase.md` uses format-commit.ts for phase commit messages
- [ ] `build-phase.md` uses run-validation.ts before validator deployment — validator focuses on criteria only
- [ ] `make-plan.md` uses archive-plan.ts for plan archival
- [ ] `make-plan.md` detects --auto flag, strips from description, persists to config.json, launches build as Task
- [ ] `check-implementation.md` uses verify-build.ts to check new-files existence and stub detection
- [ ] `scripts/extract-phase.ts` is deleted — zero references remain in any file
</criteria>

<validation>
- `grep -r "extract-phase" scripts/ commands/ templates/ agents/` — NO matches (deleted and dereferenced)
- `grep -r "init-phase" templates/build-phase.md` — present (replacement confirmed)
- `grep -r "extract-waves" templates/build-phase.md` — present
- `grep -r "update-state" templates/build-phase.md` — present
- `grep -r "manage-cache" templates/build-phase.md` — present
- `grep -r "format-commit" templates/build-phase.md` — present
- `grep -r "run-validation" templates/build-phase.md` — present
- `grep -r "archive-plan" commands/make-plan.md` — present
- `grep -r "auto" commands/make-plan.md` — --auto flag handling present
- `grep -r "verify-build" commands/check-implementation.md` — present
- `grep -r "generate-summary" commands/build.md` — present
- `grep -r "build-summary" commands/build.md` — present
- `test -f scripts/generate-summary.ts` — exists
- `test ! -f scripts/extract-phase.ts` — deleted
</validation>
</phase3>
