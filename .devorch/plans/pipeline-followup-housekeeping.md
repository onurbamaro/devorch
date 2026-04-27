# Plan: Pipeline Follow-up Housekeeping

<description>
Housekeeping pós-merge do plano "Pipeline Parallelism Quick Wins": resolve 3 pendências do verdict + 8 flags adjacent capturados em `.devorch/flags-pipeline-parallelism-quick-wins.md`. Mudanças cirúrgicas em `scripts/setup-worktree.ts`, `scripts/init-phase.ts`, `scripts/validate-plan.ts`, `scripts/lib/plan-parser.ts`, `commands/devorch.md`, `docs/PLAN-FORMAT.md` + um arquivo novo `scripts/lib/constants.ts`. Resultado esperado: cache pre-warm sem race em cold-session, magic numbers DRY'd, observabilidade em CI/sandbox, exit codes checados, validações mais defensivas, JSDoc em parser, docs corrigidas.
</description>

<objective>
(1) `setup-worktree.ts` é dono da invocação de `map-project.ts` — em sessão cold, ele garante cache fresh em `<mainRoot>/.devorch/cache/project-map.md` antes de retornar; o orchestrator de `commands/devorch.md` Step 1 passa a apenas LER o cache. (2) Constante `CACHE_FRESHNESS_MS = 5 * 60 * 1000` extraída para `scripts/lib/constants.ts` e referenciada em setup-worktree + init-phase. (3) Cache pre-warm tem observabilidade explícita: `console.error` no catch + `cachePrewarmSkipped: true` no JSON output quando copy falha. (4) `Bun.spawnSync` exits codes de git diff/ls-files checados; falha vira fallback empty + warn. (5) `validate-plan.ts` DRY-ifica os splits 303/326/362 + adiciona warn rule para tasks com `<relevant-files>` vazio mas body cita paths com extensão. (6) `parseSpecNames` ganha JSDoc cobrindo 3 spec types e regras de naming. (7) Doc tweaks: Step 7.5 sub-rule 2 menciona regex escaping; sub-rule 4 corrigido para satellite repoPath; `<relevant-files>` em PLAN-FORMAT.md fecha antes de `<new-files>`/`<secondary-repos>`.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: low
</classification>

<decisions>
Flag #6 wave-overlap regex backtick-only → opção (c) validação explícita: warn em validate-plan quando task tem <relevant-files> vazio mas body cita paths com extensão. Decisão do user no AskUserQuestion.
Flag #10 PLAN-FORMAT nesting → SAFE-TO-RESTRUCTURE confirmado por wave 2 explore: `extractTagContent` é regex tag-agnostic; nenhum parser depende da nesting; todos os 13 plans archived usam mesma forma — restructure puramente cosmética.
Pendência #1 + flag #3 + flag #4 → bundle na mesma task (todas tocam scripts/setup-worktree.ts).
Init-phase.ts mantém runMapProject() como fallback — não removido, só passa a importar a constante DRY'd. Garante que resume path (sem setup-worktree fresh) ainda regenera cache se stale.
</decisions>

<problem-statement>
O verdict do plan anterior fechou PASS mas deixou 3 pendências (cache pre-warm race em cold-session, DRY do magic number 5min, observabilidade em CI read-only) e 8 flags adjacent capturados durante review (validate-plan splits redundantes, parser sem JSDoc, doc tweaks). Cada item é cirúrgico individualmente; agrupados, geram churn em arquivos sobrepostos (setup-worktree.ts toca 3 itens; commands/devorch.md toca 3 itens). Pipeline atual ainda permite que primeira phase pague ~5-10s spawn de map-project no cold path.
</problem-statement>

<solution-approach>
Três phases sequenciais. Phase 1 reorganiza ownership do cache (setup-worktree.ts ganha responsabilidade de invocar map-project sync; orchestrator passa a só ler) e bundla tudo que toca setup-worktree.ts numa task só (#1 + #2 + #3 + #4). Phase 2 lida com fix-level mechanics em arquivos disjuntos (validate-plan + plan-parser) — tasks paralelas same-wave. Phase 3 bundla 3 doc tweaks numa task mecânica única (devorch.md grep escaping + migration template + PLAN-FORMAT nesting), seguindo a regra de bundle de Step 7 (mechanical, disjoint files, total spec <500 tokens).

Phase 1 task 1.1 cria `scripts/lib/constants.ts` (novo arquivo) e refactora setup-worktree.ts + init-phase.ts pra importar de lá. Phase 1 task 1.2 atualiza commands/devorch.md Step 1+2 wording. Files são disjuntos (constants.ts/setup-worktree.ts/init-phase.ts vs commands/devorch.md) → mesma wave, paralelo.

Alternativa rejeitada: separar #1 e #3 em phases distintas. Falha porque ambos tocam o mesmo bloco de cache pre-warm em setup-worktree (linhas 444-457) — tentar paralelizar geraria conflito de merge. Bundle é necessário.
</solution-approach>

<relevant-files>
- `scripts/setup-worktree.ts` — passa a invocar map-project sync (cache stale → run com --persist), check exit codes em git spawns, observabilidade do pre-warm copy
- `scripts/init-phase.ts` — importa CACHE_FRESHNESS_MS da nova constants.ts; runMapProject() mantido como fallback
- `scripts/validate-plan.ts` — DRY split nos sites 303/326/362; nova warn rule pra empty `<relevant-files>` com body file-mention
- `scripts/lib/plan-parser.ts` — JSDoc em `parseSpecNames` cobrindo 3 spec classes e regras de naming
- `commands/devorch.md` — Step 1 vira read-only; Step 2 vira owner do map-project; Step 7.5 sub-rule 2 menciona regex escaping; sub-rule 4 corrige template pra satellites
- `docs/PLAN-FORMAT.md` — fecha `</relevant-files>` antes de `<new-files>` e `<secondary-repos>` (sibling, não nested)

<new-files>
- `scripts/lib/constants.ts` — exporta `CACHE_FRESHNESS_MS = 5 * 60 * 1000`; outras constantes podem ser adicionadas no futuro
</new-files>
</relevant-files>

<phase1 name="Setup-worktree owns map-project + DRY constant">
<goal>setup-worktree.ts passa a ser dono da invocação de map-project (sync, --persist em mainRoot quando cache stale) + copy pra worktree; constants.ts criado e referenciado de setup-worktree e init-phase; observabilidade do pre-warm + exit code checks em git spawns; orchestrator Step 1 vira read-only.</goal>

<spec>
<behavior name="setup-worktree-owns-map-project">
  <precondition>setup-worktree.ts é executado e (a) não há `<mainRoot>/.devorch/cache/project-map.md`, OU (b) o arquivo existe mas mtime é mais antigo que `CACHE_FRESHNESS_MS`</precondition>
  <postcondition>setup-worktree spawneia `bun map-project.ts <mainRoot> --persist` via `Bun.spawnSync` (sync, exitCode checado); ao retornar, `<mainRoot>/.devorch/cache/project-map.md` existe com mtime atual; em seguida o arquivo é copiado para `<worktreePath>/.devorch/cache/project-map.md` com `preserveTimestamps: true`</postcondition>
</behavior>

<behavior name="setup-worktree-cache-fresh-skip">
  <precondition>`<mainRoot>/.devorch/cache/project-map.md` existe e mtime é mais novo que `CACHE_FRESHNESS_MS`</precondition>
  <postcondition>setup-worktree NÃO spawneia map-project (cache já fresh); apenas copia o arquivo existente para o worktree; comportamento idêntico ao atual quando cache fresh</postcondition>
</behavior>

<behavior name="cache-prewarm-observability">
  <precondition>tentativa de pre-warm cache (mkdirSync + cpSync para worktree) lança exceção — caso típico: mainRoot read-only em CI/sandbox</precondition>
  <postcondition>console.error explícito com mensagem `[setup-worktree] cache pre-warm skipped: <err>`; o JSON output ganha campo `"cachePrewarmSkipped": true`; setup-worktree continua sem falhar (exit 0)</postcondition>
</behavior>

<behavior name="git-spawn-exit-codes-checked">
  <precondition>setup-worktree.ts roda `Bun.spawnSync` para `git diff --name-only HEAD -- .devorch/` e `git ls-files --others --exclude-standard .devorch/` (linhas 411-421)</precondition>
  <postcondition>se `diffProc.exitCode !== 0` OU `untrackedProc.exitCode !== 0`, `filesToCopy` vira array vazio + console.error com mensagem nomeando qual git command falhou; build continua sem copy de .devorch files</postcondition>
</behavior>

<invariant name="cache-freshness-ms-shared">
  Existe um único símbolo `CACHE_FRESHNESS_MS = 5 * 60 * 1000` em `scripts/lib/constants.ts`; setup-worktree.ts e init-phase.ts importam dele; `git grep '5 \* 60 \* 1000' scripts/` retorna zero hits fora de constants.ts.
</invariant>

<behavior name="orchestrator-step1-reads-cache">
  <precondition>`commands/devorch.md` Step 1 é lido pelo orchestrator</precondition>
  <postcondition>texto instrui orchestrator a (a) ler `<mainRoot>/.devorch/cache/project-map.md` APÓS Step 2 retornar (cache garantido fresh por setup-worktree), e (b) NÃO dispatchar map-project.ts diretamente; nota explícita: "Step 1 não é mais paralelo a Step 2 — é uma leitura do cache que setup-worktree (Step 2) garante."</postcondition>
</behavior>

<behavior name="orchestrator-step2-owns-map-project">
  <precondition>`commands/devorch.md` Step 2 é lido pelo orchestrator</precondition>
  <postcondition>texto explicita que setup-worktree.ts agora invoca map-project.ts internamente quando cache stale; remove a nota "Step 2 pode ser dispatchado em paralelo com Step 1"; mantém referência à JSON output `cachePrewarmSkipped` quando relevante para erro report</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Setup-worktree owns map-project + observability + DRY constant
- **ID**: setup-worktree-owns-map-project
- **Assigned To**: devorch-builder
- **Spec refs**: setup-worktree-owns-map-project, setup-worktree-cache-fresh-skip, cache-prewarm-observability, git-spawn-exit-codes-checked, cache-freshness-ms-shared
- **Non-goals**: NÃO remover `runMapProject()` de init-phase.ts (mantém como fallback no resume path); NÃO mudar a forma como map-project.ts emite stdout (ele já aceita `--persist` desde o plan anterior); NÃO touch o block de copy `.devorch/` files (linhas 405-439) além das 2 linhas de exit-code check; NÃO renomear funções existentes; NÃO adicionar novas constantes além de CACHE_FRESHNESS_MS na primeira pass.
- Criar `scripts/lib/constants.ts` (arquivo novo) com `export const CACHE_FRESHNESS_MS = 5 * 60 * 1000;` + comentário 1-line explicando que é o threshold de mtime para cache fresh em setup-worktree e init-phase.
- Editar `scripts/setup-worktree.ts` linha ~1-15 (imports): adicionar `import { CACHE_FRESHNESS_MS } from "./lib/constants";`.
- Editar `scripts/setup-worktree.ts` linhas 411-421: adicionar `if (diffProc.exitCode !== 0 || untrackedProc.exitCode !== 0)` guard antes de ler stdout; se falhar, `console.error("[setup-worktree] git spawn failed (diff: <code>, untracked: <code>) — skipping .devorch copy")` + setar `filesToCopy` vazio (ou skippar o for-loop inteiro). Variáveis `changedFiles`/`untrackedFiles` só são populadas após o exit-code check.
- Editar `scripts/setup-worktree.ts` linhas 441-457 (cache pre-warm block): substituir pela nova lógica:
  - Após o block `.devorch/` copy, definir `cachePrewarmSkipped = false` flag local.
  - Verificar fresh state via `existsSync(cacheSrc)` + `statSync(cacheSrc).mtimeMs > Date.now() - CACHE_FRESHNESS_MS` (substitui o magic number da linha 448 pela constante importada).
  - Se cache NÃO fresh: spawn `Bun.spawnSync(["bun", resolve(import.meta.dir, "map-project.ts"), cwd, "--persist"], { cwd, stdout: "inherit", stderr: "inherit" })`; checar exitCode === 0; se OK, considerar fresh agora.
  - Try/catch ao redor do `mkdirSync` + `cpSync` para o worktree dst: dentro do catch, `console.error("[setup-worktree] cache pre-warm skipped: " + err.message)` + setar `cachePrewarmSkipped = true`.
  - Se cache fresh (após eventual run de map-project), copiar para `<worktreePath>/.devorch/cache/project-map.md`.
- Editar `scripts/setup-worktree.ts` linhas 466-481 (output JSON): após o spread de campos existentes, se `cachePrewarmSkipped === true`, adicionar `output.cachePrewarmSkipped = true`.
- Editar `scripts/init-phase.ts` linha ~1-30 (imports): adicionar `import { CACHE_FRESHNESS_MS } from "./lib/constants";`. Editar `isProjectMapFresh()` na linha 211: substituir `5 * 60 * 1000` por `CACHE_FRESHNESS_MS`. Função `runMapProject()` permanece — é fallback pra resume path quando setup-worktree não rodou.
- Smoke test mental: `bun scripts/setup-worktree.ts --name test-cache` deve criar worktree, ver mainRoot cache stale → spawn map-project sync → cache fresh em mainRoot E worktree. Em CI read-only (mock), copy falha → cachePrewarmSkipped: true no JSON.

#### 2. Orchestrator Step 1+2 wording: read-only Step 1
- **ID**: orchestrator-step-1-read-cache
- **Assigned To**: devorch-builder
- **Spec refs**: orchestrator-step1-reads-cache, orchestrator-step2-owns-map-project
- **Non-goals**: NÃO renumerar Steps; NÃO touch Steps 3+ (Wave 1 explore continua podendo ser dispatchado em paralelo com guardian pass — esse overlap não muda); NÃO adicionar novos overlaps; preservar tom imperativo; sem decoração.
- Editar `commands/devorch.md` Step 1 (linhas ~32-37): trocar a primeira frase (`Run bun /home/bruno/.claude/devorch-scripts/map-project.ts...`) por: `Read <mainRoot>/.devorch/cache/project-map.md (escrito por setup-worktree.ts em Step 2 quando cache não fresh).`. Remover a parte que mandava redirecionar stdout (`tee` etc) — não é mais responsabilidade do orchestrator. Manter as leituras de GOTCHAS.md, CONVENTIONS.md (legacy), e profile.yml.
- Editar `commands/devorch.md` Step 1 nota final: substituir o parágrafo "Step 1 and Step 2 can run in parallel..." por: `Step 1 lê o cache que Step 2 garante. Dispatch ordering: Step 2 primeiro (quando cache stale, ele spawneia map-project sync); Step 1 lê o arquivo após Step 2 retornar. As demais leituras de Step 1 (GOTCHAS, profile) podem rodar em paralelo com Step 2 — não dependem do cache.`
- Editar `commands/devorch.md` Step 2 abertura (linha ~41): substituir `Step 2 can be dispatched in parallel with Step 1 — there is no dependency between them.` por: `setup-worktree.ts agora é dono da invocação de map-project. Quando o cache em <mainRoot>/.devorch/cache/project-map.md não está fresh (ausente ou mtime > CACHE_FRESHNESS_MS), ele spawneia map-project sync com --persist antes de copiar pro worktree. Sob falha de copy (mainRoot read-only em CI/sandbox), o JSON output retorna cachePrewarmSkipped: true — surface como warning.`
- Re-ler o devorch.md Steps 1+2 inteiros após edits para confirmar coerência: Step 1 não dispatcha mais nada que Step 2 vai fazer; Step 2 explicita ownership.

</tasks>

<execution>
**Wave 1** (parallel): setup-worktree-owns-map-project, orchestrator-step-1-read-cache
</execution>

<criteria>
- [ ] `scripts/lib/constants.ts` existe e exporta `CACHE_FRESHNESS_MS`
- [ ] `git grep '5 \* 60 \* 1000' scripts/` retorna zero hits fora de constants.ts
- [ ] `setup-worktree.ts` checa exitCode antes de ler stdout em git diff/ls-files spawns
- [ ] `setup-worktree.ts` invoca map-project sync via `Bun.spawnSync` quando mainRoot cache stale, com `--persist`
- [ ] `setup-worktree.ts` JSON output ganha `cachePrewarmSkipped: true` quando copy falha
- [ ] `commands/devorch.md` Step 1 não invoca map-project; lê cache; Step 2 documenta ownership
- [ ] `bun scripts/setup-worktree.ts --help` ou `--name` ainda funciona (smoke validation)
</criteria>

<handoff>
Phase 2 mexe em scripts/validate-plan.ts (DRY + warn rule) e scripts/lib/plan-parser.ts (JSDoc) — files disjuntos do Phase 1, mas init-phase.ts já importa CACHE_FRESHNESS_MS daqui então a estrutura de imports lib/* está estabelecida. Phase 3 mexe em commands/devorch.md (sub-rules 2+4) que NÃO sobrepõe com edits de Phase 1 (Step 1+2). PLAN-FORMAT.md também é Phase 3 — disjoint.
</handoff>
</phase1>

<phase2 name="validate-plan + plan-parser hygiene">
<goal>DRY o split redundante em validate-plan.ts (sites 303/326/362), adiciona nova warn rule pra empty `<relevant-files>` com body file-mention, e adiciona JSDoc em parseSpecNames cobrindo 3 spec classes.</goal>

<spec>
<behavior name="validate-plan-dry-split">
  <precondition>validate-plan.ts itera per-phase e os sites 303, 326, 362 todos chamam `tasksContent.split(/####\s+\d+\.\s+/)` — 3 splits redundantes na mesma iteração</precondition>
  <postcondition>`taskSections` é computado uma única vez no topo da per-phase loop (antes do site 303) e reusado nos 3 sites; o resultado lógico não muda; site 517 (em loop secondary-repos cross-phase) permanece intocado por estar em scope diferente</postcondition>
</behavior>

<behavior name="validate-plan-empty-relevant-files-warn">
  <precondition>uma task em qualquer phase tem `<relevant-files>` vazio ou ausente, mas o body da task menciona pelo menos um path em backticks com extensão (ex: `` `src/foo.ts` ``)</precondition>
  <postcondition>validate-plan emite WARNING (não error — não bloqueia validação) com mensagem `Task <id> tem <relevant-files> vazio mas menciona paths no body: <list>. Declare-os explicitamente em <relevant-files> para que wave-overlap detection funcione.`; cada warning conta no `summary.warnings` count</postcondition>
</behavior>

<invariant name="parse-spec-names-jsdoc">
  `scripts/lib/plan-parser.ts:98` (signature de `parseSpecNames`) tem JSDoc bloco docstring acima cobrindo: (a) os 3 spec types iterados (named tags interface/error-contract/behavior/entity, invariant, endpoint), (b) regra de naming explícito (`name="..."` para named tags), (c) regra de naming implícito (ordinal `invariant-N` para invariants; `METHOD-path` para endpoints), (d) que invariants podem ter ambos (ordinal + explicit name dedup'd no fim).
</invariant>
</spec>

<tasks>
#### 1. Validate-plan DRY split + new empty-relevant-files warn rule
- **ID**: validate-plan-dry-and-warn
- **Assigned To**: devorch-builder
- **Spec refs**: validate-plan-dry-split, validate-plan-empty-relevant-files-warn
- **Non-goals**: NÃO touch o split na linha 517 (loop secondary-repos é cross-phase, scope diferente — flag explicitamente declara isso); NÃO mudar a regex existente de fileRefs em linhas 369-371; NÃO transformar o novo warning em error; NÃO touch outros warnings/errors existentes; preservar a estrutura de `summary` retornado.
- Editar `scripts/validate-plan.ts` per-phase loop (abertura em ~linha 107 ou onde for o body do `for (const phase of phases)`): no início do body, após extrair `tasksContent`, computar uma vez `const taskSections = tasksContent.split(/####\s+\d+\.\s+/).slice(1);` (ou idem ao split atual) e reusar nos 3 sites internos.
- Sites 303, 326, 362: substituir `tasksContent.split(...)` por reuso de `taskSections`. Verificar que o `.slice(1)` ou off-by-one-handling matche o que cada site espera (ler código atual para confirmar — alguns sites podem precisar do índice 0 da array).
- Adicionar nova validation rule perto do block que extrai fileRefs (linhas 354-449, dentro da wave conflict detection ou logo antes): para cada task, se `relevantFiles.length === 0` mas o body matchea regex de path com extensão (ex: `` /`[^`]*\.(ts|tsx|js|jsx|md|sql|json|yaml|yml|sh|py|css|html)`/g `` — capturar paths em backtick com extensão conhecida), emitir warning via push em `summary.warnings`. Mensagem segue o formato citado no spec.
- Smoke test: rodar `bun scripts/validate-plan.ts --plan .devorch/plans/pipeline-followup-housekeeping.md` (este próprio plano) — não deve emitir o novo warning porque todas as tasks do plano declaram `<relevant-files>` no plan-level. (Plan-level relevant-files cobre tasks via inferência ou tasks declaram explicitamente — verificar comportamento atual antes de assumir.)
- Atualizar GOTCHAS.md? Não — gotcha existente sobre wave file-overlap regex backtick-only continua válido (descreve a regex de fileRefs em validate-plan.ts:369-371 que NÃO está mudando). A nova warn rule é defesa adicional; não invalida o gotcha.

#### 2. parseSpecNames JSDoc
- **ID**: parse-spec-names-jsdoc
- **Assigned To**: devorch-builder
- **Spec refs**: parse-spec-names-jsdoc
- **Non-goals**: NÃO refatorar a função em sub-funções (a flag sugere "opcionalmente" — pulamos por ora; JSDoc é low-risk, refactor é judgment-heavy); NÃO mudar o comportamento da função; NÃO mudar a signature (`(specContent: string): string[]`); NÃO touch as outras funções em plan-parser.ts.
- Editar `scripts/lib/plan-parser.ts` linha 98: adicionar bloco JSDoc imediatamente acima de `export function parseSpecNames(...)` com:
  - Descrição 1-line: "Extracts spec element names from a `<spec>` block."
  - Section "Spec types iterated": bullet 1 (Named tags: interface, error-contract, behavior, entity → explicit `name="..."` attribute required), bullet 2 (Invariant: implicit ordinal `invariant-N` always added; if `name="..."` present, also added — dedup'd later), bullet 3 (Endpoint: implicit `METHOD-/path` derived from method+path attributes).
  - Section "Returns": "Deduplicated array preserving first-occurrence order."
  - Mantém o JSDoc curto e factual — sem exemplos de código (se virar verboso, limita-se ao essencial).
- Smoke test mental: re-ler a função e o JSDoc — invariants implícitos (ordinal) e endpoints implícitos (METHOD-path) devem estar visualmente óbvios na doc para um leitor que nunca leu o regex.

</tasks>

<execution>
**Wave 1** (parallel): validate-plan-dry-and-warn, parse-spec-names-jsdoc
</execution>

<criteria>
- [ ] `scripts/validate-plan.ts` per-phase loop computa taskSections uma vez e reusa nos 3 sites locais (303/326/362)
- [ ] `scripts/validate-plan.ts` emite warning quando task tem `<relevant-files>` vazio mas body cita paths com extensão
- [ ] `scripts/lib/plan-parser.ts:parseSpecNames` tem JSDoc cobrindo 3 spec types + naming rules
- [ ] `bun scripts/validate-plan.ts --plan .devorch/plans/pipeline-followup-housekeeping.md` passa com `result: continue`
</criteria>

<handoff>
Phase 3 mexe em commands/devorch.md (sub-rules 2+4 do Step 7.5) e docs/PLAN-FORMAT.md — files disjuntos de Phase 2. Phase 1 já tocou commands/devorch.md em Steps 1+2 mas não em Step 7.5 — sem overlap. Wave 2 explore (Step 5 do orchestrator) confirmou que extractTagContent é tag-agnostic, então restructure de PLAN-FORMAT.md é seguro.
</handoff>
</phase2>

<phase3 name="Doc + instruction tweaks (mechanical bundle)">
<goal>3 doc tweaks bundlados numa task mecânica única: Step 7.5 sub-rule 2 menciona regex escaping; sub-rule 4 corrige template ambíguo pra satellites; PLAN-FORMAT.md fecha `</relevant-files>` antes de `<new-files>`/`<secondary-repos>`.</goal>

<spec>
<behavior name="step-7-5-grep-escaping-noted">
  <precondition>commands/devorch.md Step 7.5 sub-rule 2 (linha ~162) é lido pelo orchestrator</precondition>
  <postcondition>texto inclui frase explícita: `Escapar metachars (\`.\`, \`*\`, \`+\`, \`[\`) nos patterns; alternation só cobre paths literais simples — para paths com chars especiais, separe em greps individuais.`</postcondition>
</behavior>

<behavior name="step-7-5-migration-template-clarified">
  <precondition>commands/devorch.md Step 7.5 sub-rule 4 (linha ~170) é lido pelo orchestrator</precondition>
  <postcondition>template é corrigido para `git -C <satellite.repoPath> ls-tree origin/<mainBranch>:db/migrations/` (sem o spurious `<satellite>/db/migrations/`); nota explícita "git roda dentro do satellite repo, então o tree path é relativo a esse repo, não ao mainRoot"</postcondition>
</behavior>

<behavior name="plan-format-relevant-files-siblings">
  <precondition>docs/PLAN-FORMAT.md template (linhas 42-57) tem `<relevant-files>` envolvendo `<new-files>` e `<secondary-repos>`</precondition>
  <postcondition>`</relevant-files>` é fechado ANTES de `<new-files>` e `<secondary-repos>`; os 3 tags ficam como siblings de mesmo nível; rules e validation checklist atualizadas se mencionavam nesting; nenhum parser quebra (já confirmado SAFE pelo Wave 2 explore)</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Mechanical doc fixes (devorch.md sub-rules 2+4 + PLAN-FORMAT nesting)
- **ID**: mechanical-doc-fixes
- **Assigned To**: devorch-builder
- **Spec refs**: step-7-5-grep-escaping-noted, step-7-5-migration-template-clarified, plan-format-relevant-files-siblings
- **Non-goals**: NÃO touch parser code (já validado Wave 2 que mexer em PLAN-FORMAT.md template é seguro); NÃO renumerar Steps em devorch.md; NÃO touch sub-rules 1 e 3 do Step 7.5; NÃO mudar a forma de plans existentes em `.devorch/plans/archive/` (apenas o template doc — plans existentes continuam válidos pelo parser tag-agnostic); preservar tom imperativo.
- Editar `commands/devorch.md` Step 7.5 sub-rule 2 (linha ~162): após a frase atual sobre `grep -E '<pat1>|<pat2>'`, adicionar nova frase: `Escapar metachars (\`.\`, \`*\`, \`+\`, \`[\`) nos patterns — alternation só cobre paths literais simples; para paths com chars especiais, separe em greps individuais.`
- Editar `commands/devorch.md` Step 7.5 sub-rule 4 (linha ~170): substituir o template atual `git -C <repo> ls-tree origin/<mainBranch>:<satellite>/db/migrations/` por `git -C <satellite.repoPath> ls-tree origin/<mainBranch>:db/migrations/`. Adicionar nota imediatamente após: `(git roda dentro do satellite repo via -C, então o tree path é relativo a esse repo — não prefixar com <satellite>/.)` Para o caso primary, manter template como hoje (`git -C <projectRoot> ls-tree origin/<mainBranch>:db/migrations/`) — sem mudança.
- Editar `docs/PLAN-FORMAT.md` linhas 42-57: reorganizar para que o tag `relevant-files` feche imediatamente após o conteúdo (linha de `- path — why`), ANTES dos tags `new-files` e `secondary-repos`. Os 3 tags ficam siblings de mesmo nível (não nested). Estrutura final esperada: `relevant-files` abre, lista paths, fecha — então linha em branco — então `new-files` abre, lista paths, fecha — então linha em branco — então `secondary-repos` (optional, com comment marker como hoje) abre, lista repos, fecha. Veja a estrutura nas linhas 36-42 deste plano (`<relevant-files>` deste próprio file) como referência viva.
- Em PLAN-FORMAT.md § Rules ou § Validation checklist, scan se há menção textual de "nested" ou "inside `<relevant-files>`" → se houver, atualizar pra refletir sibling-form. Se não há menção, deixar como está (rules continuam válidas — o parser não muda).
- Smoke test: rodar `bun scripts/validate-plan.ts --plan .devorch/plans/pipeline-followup-housekeeping.md` (este plano) → deve passar sem warnings novos. Plans archived continuam válidos (extractTagContent é tag-agnostic).

</tasks>

<execution>
**Wave 1**: mechanical-doc-fixes
</execution>

<criteria>
- [ ] `commands/devorch.md` Step 7.5 sub-rule 2 menciona regex metachar escaping
- [ ] `commands/devorch.md` Step 7.5 sub-rule 4 usa template `git -C <satellite.repoPath> ls-tree origin/<mainBranch>:db/migrations/` sem `<satellite>/` no tree path
- [ ] `docs/PLAN-FORMAT.md` linhas ~42-57 mostram `<relevant-files>`, `<new-files>`, `<secondary-repos>` como siblings (não nested)
- [ ] `bun scripts/validate-plan.ts --plan .devorch/plans/pipeline-followup-housekeeping.md` passa
</criteria>
</phase3>
