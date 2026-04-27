# Plan: Pipeline Parallelism Quick Wins

<description>
Cinco quick-wins de paralelismo no pipeline do devorch + housekeeping do dead code `<explore-queries>`. Mudanças cirúrgicas em prompt (`commands/devorch.md`) e três scripts (`validate-plan.ts`, `setup-worktree.ts`, `lib/plan-parser.ts`) + doc (`PLAN-FORMAT.md`). Resultado esperado: ~5 min de wall-time poupados em build típico de 2 phases × 3 tasks.
</description>

<objective>
Pipeline do devorch passa a permitir same-repo waves com files disjuntos (warning em vez de error), pré-aquece cache de project-map no worktree, declara overlaps explícitos entre Step 1+2 e Step 3+4, batches greps de Step 7.5, e remove o slot dead `<explore-queries>` para reduzir confusão documental. Validação: validate-plan.ts aceita o próprio plano deste build com 3 tasks same-repo em waves separadas (compatível com regra atual); setup-worktree.ts copia cache quando aplicável; commands/devorch.md reflete os novos overlaps em Steps 1-4 e 7.5.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: low
</classification>

<decisions>
Item 1 file-overlap rule → erro só com overlap real; warning quando 2+ same-repo tasks são disjuntas (decisão do user no prompt).
Item 5 staleness policy → cache só é copiado se mtime < 5 min; senão skip silencioso (decisão do user no prompt).
Item 6 housekeeping → remover `<explore-queries>` de plan-parser, validate-plan e PLAN-FORMAT (decisão do user).
Bifurcação `<execution>` flag opt-in para shared-worktree → não introduzir agora; se a regra de warning não for suficiente, item 2 do flow-issue cobre o follow-up.
</decisions>

<problem-statement>
O pipeline do devorch tem três tipos de paralelismo deixados na mesa: (a) `validate-plan.ts:443-449` rejeita incondicionalmente waves com 2+ tasks no mesmo repo, mesmo quando `<relevant-files>` são totalmente disjuntos — adiciona ~3-4 min de wall-time por plan multi-task; (b) Steps 1+2 e Steps 3+4 do `commands/devorch.md` são sequenciais por convenção, embora consumam inputs independentes; (c) Step 7.5 sub-rule 2 dispara um grep por task, pagando round-trip por chamada. Adicionalmente, o slot `<explore-queries>` é parseado e validado mas nunca consumido — risco de alguém escrever esperando comportamento.
</problem-statement>

<solution-approach>
Três tasks paralelizáveis sobre arquivos disjuntos (`commands/devorch.md`, scripts/validate-plan.ts + scripts/lib/plan-parser.ts + docs/PLAN-FORMAT.md, `scripts/setup-worktree.ts`). Como o próprio validator atual ainda rejeita same-repo waves com 2+ tasks, este plano roda 3 waves de 1 task cada — meta-ironia consciente: o ganho do quick-win #1 só beneficia plans futuros, não este. Trade-off aceito.

Cada task implementa edits cirúrgicos: sem refactor, sem reorganização, sem novos abstractions. Validate-plan altera apenas o bloco de same-repo conflict detection para conditionar no overlap de files. Setup-worktree adiciona ~10 linhas de cache-copy condicional após o block de `.devorch/` copy. Devorch.md edita Steps 1, 2, 3, 4 e 7.5 com instruções de paralelização e batch.

Alternativa considerada e rejeitada: bundling tudo em 1 task mecânica. Falha o critério "trivial mechanical fixes" (>30 linhas de spec, judgment-heavy em validate-plan e setup-worktree).
</solution-approach>

<relevant-files>
- `commands/devorch.md` — prompt do orchestrator; edits em Steps 1, 2, 3, 4, 7.5
- `scripts/validate-plan.ts` — validator; alterar wave conflict detection + remover validação de explore-queries
- `scripts/setup-worktree.ts` — worktree creation; adicionar cache pre-warm copy
- `scripts/lib/plan-parser.ts` — remover função `extractExploreQueries`
- `docs/PLAN-FORMAT.md` — remover bloco `<explore-queries>` da doc
</relevant-files>

<phase1 name="Quick wins implementation">
<goal>Implementar os 5 quick-wins de paralelismo + housekeeping em 3 tasks disjuntas, uma wave por task (compatibilidade com validator atual).</goal>

<spec>
<behavior name="wave-conflict-overlap-blocks">
  <precondition>validate-plan.ts recebe um plano com Wave N contendo 2+ tasks no mesmo Repo cujos `<relevant-files>` (extraídos via regex de backtick-quoted paths) compartilham pelo menos um arquivo</precondition>
  <postcondition>script emite erro hard com mensagem citando os task IDs envolvidos e os arquivos em overlap; exit code não-zero quando o validator é run standalone</postcondition>
</behavior>

<behavior name="wave-conflict-disjoint-warns">
  <precondition>validate-plan.ts recebe um plano com Wave N contendo 2+ tasks no mesmo Repo cujos `<relevant-files>` extraídos não se sobrepõem</precondition>
  <postcondition>script emite warning (não erro) sinalizando que builders concorrentes compartilharão worktree e podem ter contention em typecheck/lint; validation passes</postcondition>
</behavior>

<behavior name="explore-queries-removed">
  <precondition>código fonte do devorch contém referências a `extractExploreQueries`, `<explore-queries>` doc, e validation loop</precondition>
  <postcondition>função removida de plan-parser.ts, import + validation block removidos de validate-plan.ts, doc removida de PLAN-FORMAT.md; `git grep extractExploreQueries` retorna zero hits em `scripts/` e `docs/` (archive plans podem reter)</postcondition>
</behavior>

<behavior name="cache-prewarm-fresh">
  <precondition>setup-worktree.ts terminou de criar worktree primary; arquivo `<mainRoot>/.devorch/cache/project-map.md` existe com mtime menos de 5 minutos</precondition>
  <postcondition>arquivo é copiado para `<worktreePath>/.devorch/cache/project-map.md` preservando timestamps; init-phase.ts encontra cache fresh na primeira phase</postcondition>
</behavior>

<behavior name="cache-prewarm-skip">
  <precondition>arquivo `<mainRoot>/.devorch/cache/project-map.md` não existe, ou existe mas mtime maior ou igual a 5 minutos</precondition>
  <postcondition>nenhuma cópia ocorre; nenhum erro; setup-worktree continua normalmente</postcondition>
</behavior>

<behavior name="step-1-2-parallel-instruction">
  <precondition>commands/devorch.md Step 1 e Step 2 são lidos pelo orchestrator</precondition>
  <postcondition>texto explicita que Step 1 (`map-project.ts` + leituras de GOTCHAS/profile) e Step 2 (`setup-worktree.ts`) podem ser dispatchados em paralelo via tool-calls múltiplas em uma só mensagem, já que ambos rodam contra mainRoot e não dependem do output um do outro</postcondition>
</behavior>

<behavior name="step-1-cache-write-instruction">
  <precondition>commands/devorch.md Step 1 é lido pelo orchestrator</precondition>
  <postcondition>texto instrui o orchestrator a redirecionar o stdout de `map-project.ts` para `<mainRoot>/.devorch/cache/project-map.md` (criando o diretório se necessário) — alimenta o cache que `setup-worktree.ts` vai copiar para o worktree</postcondition>
</behavior>

<behavior name="step-3-4-overlap-instruction">
  <precondition>commands/devorch.md Step 3 (Guardian pass) e Step 4 (Wave 1 explore) são lidos pelo orchestrator</precondition>
  <postcondition>texto explicita que o Wave 1 explore pode ser dispatchado antes ou em paralelo com a guardian pass inline, já que ambos consomem os mesmos inputs (`$ARGUMENTS + map-project + GOTCHAS`); guardian é refinada de novo em Step 5 com explore findings completos</postcondition>
</behavior>

<behavior name="step-7-5-grep-batch-instruction">
  <precondition>commands/devorch.md Step 7.5 sub-rule 2 (Grep verification) é lido pelo orchestrator</precondition>
  <postcondition>texto instrui o orchestrator a juntar greps de implicit-touch verification de múltiplas tasks numa única invocação Bash quando os patterns/paths permitirem (ex: `git ls-files | grep -E '<pat1>|<pat2>'`), em vez de uma chamada por task</postcondition>
</behavior>

<invariant name="orchestrator-instructions-coherent">As edits em commands/devorch.md preservam a numeração e sequência de Steps; nenhum Step é renumerado, removido, ou re-ordenado. Apenas o texto interno e novas notas de overlap são adicionadas.</invariant>

<invariant name="no-test-regressions">Nenhum dos arquivos editados tem suite de testes formal; smoke test é validate-plan.ts rodando contra o próprio plano deste build (Step 8 do pipeline). Mudanças que quebrem essa invocação são bloqueantes.</invariant>
</spec>

<tasks>
#### 1. Validate-plan disjoint-files + remove explore-queries dead code
- **ID**: validate-plan-disjoint
- **Assigned To**: devorch-builder
- **Spec refs**: wave-conflict-overlap-blocks, wave-conflict-disjoint-warns, explore-queries-removed
- **Non-goals**: não alterar a forma como `<relevant-files>` é extraído (regex de backtick-paths fica como está); não introduzir flag `<execution>` para opt-in shared-worktree (deferido); não touch outros validations (spec/entity/endpoint).
- Editar `scripts/validate-plan.ts` no bloco de wave conflict detection (linhas ~432-449): trocar o hard error de "2+ same-repo" por (a) erro quando há overlap de files entre tasks same-repo, (b) warning quando files são disjuntos. Reusar a lógica de overlap já existente nas linhas 419-430 (que hoje só warn por overlap genérico) — agora a presença de overlap entre same-repo tasks vira erro hard, e ausência de overlap entre same-repo tasks vira warning explícito sobre worktree contention.
- Editar `scripts/validate-plan.ts` linha 8: remover `extractExploreQueries` do import.
- Editar `scripts/validate-plan.ts` linhas ~380-396: remover o bloco inteiro de explore-queries validation.
- Editar `scripts/lib/plan-parser.ts` linhas 169-182: remover a função `extractExploreQueries` (seu único caller é validate-plan.ts, que está sendo limpo na mesma task).
- Editar `docs/PLAN-FORMAT.md` linhas ~93-97: remover o bloco `<explore-queries>` e qualquer menção em § Rules ou Validation checklist.
- Validar com `bun ../../scripts/validate-plan.ts --plan ../../.devorch/plans/pipeline-parallelism-quick-wins.md` (do worktree) — deve retornar `result: continue` sem warnings sobre explore-queries.

#### 2. Setup-worktree cache pre-warm
- **ID**: setup-worktree-cache-prewarm
- **Assigned To**: devorch-builder
- **Spec refs**: cache-prewarm-fresh, cache-prewarm-skip
- **Non-goals**: não tocar nas outras seções de copy (`.env`, `.devorch/` file-by-file); não regenerar cache quando stale (deferido — apenas skip silencioso).
- Editar `scripts/setup-worktree.ts` após o bloco de copy de `.devorch/` files (após linha 438, antes do `// Setup satellite worktrees if --secondary provided` na linha 441): adicionar lógica que (a) verifica existência de `<cwd>/.devorch/cache/project-map.md`, (b) lê seu mtime via `statSync().mtimeMs`, (c) se mtime > now-5min, cria `<worktreePath>/.devorch/cache/` (mkdirSync recursive) e copia o arquivo via `cpSync` com `preserveTimestamps: true`.
- Não alterar o output JSON do script (não adicionar campo novo); falha de copy (raríssima — diretório just-created) deve apenas registrar `console.error` e seguir.
- Smoke test mental: rodar `bun setup-worktree.ts --name test-cache-prewarm` no devorch e confirmar via `ls .worktrees/test-cache-prewarm/.devorch/cache/` (após cleanup do test).

#### 3. Devorch.md prompt edits — Steps 1, 2, 3, 4, 7.5
- **ID**: devorch-md-prompt-edits
- **Assigned To**: devorch-builder
- **Spec refs**: step-1-2-parallel-instruction, step-1-cache-write-instruction, step-3-4-overlap-instruction, step-7-5-grep-batch-instruction
- **Non-goals**: não renumerar Steps; não tocar em Steps 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 ou nas seções "Unified gate UX", "Gotcha capture", "Worktree policy", "Rules"; não introduzir novos overlaps além dos quatro instruídos (Step 1+2 e Step 3+4 são os únicos da lista); preservar o tom do prompt (imperativo, sem narração de motivo).
- Editar `commands/devorch.md` Step 1 (linha ~32-34): adicionar instrução final de redirecionar stdout do `map-project.ts` para `<mainRoot>/.devorch/cache/project-map.md` (criando dir se necessário). Adicionar nota: "Step 1 e Step 2 podem rodar em paralelo (mesma mensagem com tool calls múltiplas) — independentes."
- Editar `commands/devorch.md` Step 2 (linhas ~36-44): adicionar nota simétrica no início: "Step 2 pode ser dispatchado em paralelo com Step 1 (não há dependência)."
- Editar `commands/devorch.md` Step 3 (linhas ~46-75) e Step 4 (linhas ~77-86): adicionar nota explícita entre o final de Step 3 e o início de Step 4 indicando que Wave 1 explore pode ser dispatchado antes ou em paralelo com a guardian pass inline (mesmos inputs, guardian é refinada de novo em Step 5).
- Editar `commands/devorch.md` Step 7.5 sub-rule 2 (linha ~156): instruir batching de greps numa única invocação Bash quando os patterns/paths permitirem (ex: `git ls-files | grep -E '<p1>|<p2>'`), em vez de uma chamada por task.
- Manter "Plain markdown only. No box-drawing." Sem listas decorativas; tom imperativo.
- Smoke test mental: re-ler o devorch.md inteiro depois das edits — Steps são contíguos, numeração intacta, sem texto duplicado.
</tasks>

<execution>
**Wave 1**: validate-plan-disjoint
**Wave 2** (após wave 1): setup-worktree-cache-prewarm
**Wave 3** (após wave 2): devorch-md-prompt-edits
</execution>

<criteria>
- [ ] `validate-plan.ts` rejeita waves same-repo com files em overlap, e apenas warn quando disjuntas
- [ ] `extractExploreQueries` removido de plan-parser.ts; sem hits em `git grep extractExploreQueries scripts/ docs/`
- [ ] `setup-worktree.ts` copia `project-map.md` quando fresh em mainRoot; skip silencioso quando absent ou stale
- [ ] `commands/devorch.md` Steps 1+2 e 3+4 declaram overlap; Step 7.5 sub-rule 2 menciona grep batching; Step 1 instrui escrita do cache
- [ ] Step 8 do pipeline (validate-plan deste plano) passa com `result: continue`
</criteria>
</phase1>
