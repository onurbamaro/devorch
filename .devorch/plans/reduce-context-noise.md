# Plan: reduce context noise

<description>
Trim context ruído injetado por map-project.ts e map-conventions.ts em sessões fast-path, sem regressão em planos medium/complex. Adiciona marker Fast-path na classification para propagar decisão entre /devorch:talk e /devorch:build.
</description>

<objective>
Reduzir tokens de contexto injetados por sessão fast-path em 50%+ mantendo sinal acionável. Plans medium/complex preservam mapa + conventions completos.
</objective>

<classification>
Type: enhancement
Complexity: simple
Risk: low
Fast-path: true
</classification>

<decisions>
- Filtering de EXT_KEYWORDS → Tightening moderado: remover 'testing' e 'gotcha' das keywords de .ts/.tsx/.js/.jsx (manter 'error'); Testing ainda ativa se task refs contêm *.test.* / *.spec.* ou task body menciona test/spec via regex.
- Patterns section em map-conventions.ts → Manter só Module boundaries top-5; remover Function signatures AST e Import clusters (ruído sem ação; builder relê arquivo).
- Fast-path signal entre talk e build → Marker `Fast-path: true` no bloco <classification> do plan. validate-plan aceita, init-phase detecta e aplica reduções.
- Tree depth em fast-path → Flag --compact em map-project.ts (3 níveis, omit Recent Commits, Dependencies top-5). Usado apenas quando Fast-path: true.
</decisions>

<relevant-files>
- `scripts/map-conventions.ts` — emite seção ## Patterns com subseções Function signatures / Import clusters / Module boundaries
- `scripts/map-project.ts` — gera project snapshot com tree completo + deps top-15 + Recent Commits
- `scripts/init-phase.ts` — invoca map-project, filtra EXT_KEYWORDS, gera conventionSectionsByTask
- `scripts/validate-plan.ts` — valida classification (Type, Complexity, Risk); precisa aceitar Fast-path
- `commands/devorch/talk.md` — detecta fast-path condition, emite plano; deve invocar map-project --compact e marcar classification
</relevant-files>

<phase1 name="Trim context surface">
<goal>Cortar ruído em map-project/map-conventions/EXT_KEYWORDS sob opt-in Fast-path sem alterar comportamento default.</goal>

<spec>
<behavior name="patterns-section-trim">
  <precondition>map-conventions.ts emite ## Patterns com 3 subseções: Function signatures (from AST), Import clusters, Module boundaries</precondition>
  <postcondition>## Patterns emite SOMENTE Module boundaries top-5. Código que emite Function signatures e Import clusters removido completamente. Demais seções (Naming, Exports/Imports, Style, Error Handling, Testing, Active Workarounds, Gotchas, Component Patterns) inalteradas.</postcondition>
</behavior>

<interface name="compact-flag">
  <input>map-project.ts aceita argumentos: [project-dir] [--persist] [--compact]</input>
  <output>Quando --compact presente: tree limitado a 3 níveis de profundidade; seção Recent Commits omitida; seção Dependencies truncada a top 5 (não top 15); demais seções (Tech Stack, Sibling Repos, Structure header) preservadas. Quando ausente: comportamento atual intacto.</output>
  <error case="invalid-flag">Flags desconhecidas ignoradas silenciosamente (consistente com behavior atual de --persist)</error>
</interface>

<behavior name="ext-keywords-tightening">
  <precondition>EXT_KEYWORDS em init-phase.ts mapeia .ts/.tsx/.js/.jsx para lista que inclui tokens 'testing' e 'gotcha'</precondition>
  <postcondition>Tokens 'testing' e 'gotcha' removidos das listas de .ts, .tsx, .js, .jsx. Token 'error' mantido. Extensões não-JS/TS (.md, .json, .css, .scss) inalteradas.</postcondition>
</behavior>

<behavior name="testing-contextual-include">
  <precondition>filterConventionsForTask recebe task refs + task body. Section ## Testing só aparece se keyword 'testing' matcher header ou content.</precondition>
  <postcondition>Após remover 'testing' das EXT_KEYWORDS, adicionar detecção contextual: se qualquer task ref bate com padrão `/\.(test|spec)\.[tj]sx?$/` OU task body (case-insensitive) contém `\btest\b` ou `\bspec\b`, incluir "## Testing" no array de seções do task. Evita perda de sinal quando task toca test files.</postcondition>
</behavior>

<behavior name="fast-path-detection-init-phase">
  <precondition>Plan classification block pode conter linha 'Fast-path: true' ou 'Fast-path: false' ou ausente.</precondition>
  <postcondition>init-phase.ts parseia classification. Quando Fast-path=true: runMapProject invoca map-project.ts com flag --compact adicional; conventionSectionsByTask filtrado após EXT_KEYWORDS é interceptado e reduzido ao whitelist fixo {"## Naming", "## Exports & Imports", "## Style", "## Error Handling", "## Patterns"} (intersecção com sections presentes). Quando Fast-path ausente ou false: comportamento atual intacto.</postcondition>
</behavior>

<error-contract name="fast-path-field-validation">
  <case trigger="classification contém linha matching /^Fast-path:\s*(true|false)\s*$/" handling="aceitar, sem erro" />
  <case trigger="classification contém 'Fast-path:' com valor diferente de true/false" handling="emitir erro de validação com mensagem clara indicando valores aceitos" />
  <case trigger="classification não contém Fast-path" handling="tratar como Fast-path=false implicitamente, válido" />
</error-contract>

<behavior name="talk-fast-path-propagation">
  <precondition>/devorch:talk detecta fast-path condition no Step 2 (paths específicos + ação explícita + contexto suficiente)</precondition>
  <postcondition>Quando fast-path detectado: Step 1 do talk.md instrui a invocar map-project.ts com --compact. Step 7/7i emite plan com linha 'Fast-path: true' no bloco classification. Quando não fast-path: plan omite linha ou emite 'Fast-path: false'.</postcondition>
</behavior>

<invariant>Nenhum corte de contexto aplica-se quando Fast-path: true está ausente do plan; medium/complex plans preservam comportamento atual integralmente.</invariant>

<invariant>map-project.ts sem flag --compact, map-conventions.ts (exceto subseções Function signatures/Import clusters), init-phase.ts sem marker Fast-path, validate-plan.ts aceitando classification sem campo Fast-path — todos mantêm backward compatibility com plans existentes.</invariant>
</spec>

<tasks>
#### 1. Trim map-conventions Patterns section
- **ID**: trim-map-conventions
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: patterns-section-trim
- Em `scripts/map-conventions.ts`, localizar função/bloco que emite subseções "Function signatures (from AST)" e "Import clusters" dentro de ## Patterns.
- Remover integralmente o código que gera essas duas subseções (incluindo análise ts-morph de function declarations e import clustering).
- Preservar Module boundaries top-5 intacto.
- Manter o header `## Patterns` e o fallback "no TypeScript files" quando não houver TS files.
- Outras seções (Naming, Exports/Imports, Style, Error Handling, Testing, Active Workarounds, Gotchas, Component Patterns) inalteradas.
- Rodar script contra /home/bruno/dev/devorch antes de commitar para verificar output.

#### 2. Add --compact flag to map-project
- **ID**: add-compact-flag
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: compact-flag
- Em `scripts/map-project.ts`, adicionar parsing para flag `--compact` (similar ao parsing existente de `--persist`).
- Quando `--compact` presente:
  - Limitar tree rendering a 3 níveis de profundidade (top level + 2 nested).
  - Omitir seção "## Recent Commits" completamente.
  - Truncar "## Dependencies (top 15)" para top 5; renomear header para "## Dependencies (top 5)".
  - Manter seções Tech Stack, Structure header, Scripts, Sibling Repos.
- Flag `--persist` continua funcionando; pode combinar com `--compact`.
- Rodar `bun scripts/map-project.ts --compact` contra repo para validar output enxuto.

#### 3. Tighten EXT_KEYWORDS + Fast-path detection
- **ID**: tighten-init-phase
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: ext-keywords-tightening, testing-contextual-include, fast-path-detection-init-phase
- Em `scripts/init-phase.ts`:
  - Remover `'testing'` e `'gotcha'` das listas EXT_KEYWORDS para chaves `.ts`, `.tsx`, `.js`, `.jsx`. Preservar `'error'`.
  - Em `filterConventionsForTask`, após matching por EXT_KEYWORDS produzir o array base de headers, adicionar regra pós-filter: se qualquer task ref match `/\.(test|spec)\.[tj]sx?$/` OU task body (case-insensitive) contém `\btest\b` ou `\bspec\b`, adicionar `"## Testing"` ao array se não presente e se seção existir em conventionsText.
  - Adicionar parser para classification block que extrai campo `Fast-path: true|false`. Expor como `planFastPath: boolean` no escopo do phase init.
  - Quando `planFastPath === true`:
    - `runMapProject()` deve invocar map-project.ts com argumento adicional `--compact` (mantendo --persist se já usado).
    - Após `filterConventionsForTask` retornar array de headers, interceptar e aplicar whitelist: `["## Naming", "## Exports & Imports", "## Style", "## Error Handling", "## Patterns"]`. Calcular intersecção com o array filtrado e com as seções efetivamente presentes no conventionsText. Retornar só o subconjunto.
  - Quando `planFastPath === false` ou ausente: zero mudanças de comportamento.
- Testar manualmente com plan contendo Fast-path: true e plan sem marker para confirmar.

#### 4. Accept Fast-path field in validate-plan
- **ID**: accept-fastpath-field
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: fast-path-field-validation
- Em `scripts/validate-plan.ts`, localizar validação do bloco `<classification>`.
- Adicionar regex matching para linha opcional `Fast-path:\s*(true|false)`. Aceitar sem erro.
- Se a linha existir mas valor não for `true` nem `false`, emitir erro de validação: `Invalid Fast-path value in classification: expected 'true' or 'false', got '<value>'`.
- Se linha ausente, não emitir erro.
- Preservar validações existentes de Type, Complexity, Risk.
- Rodar `bun scripts/validate-plan.ts --plan <worktree>/.devorch/plans/reduce-context-noise.md` para confirmar que passa (plan tem Fast-path: true).

#### 5. Propagate Fast-path in talk command
- **ID**: propagate-fastpath
- **Assigned To**: devorch-builder-deep
- **Model**: opus
- **Effort**: high
- **Spec refs**: talk-fast-path-propagation
- Em `commands/devorch/talk.md`:
  - Localizar Step 1 "Load context" e Step 2 "Explore" (fast-path condition).
  - No Step 1, documentar: "Se a fast-path condition (definida no Step 2) será acionada pela request, invocar map-project.ts com argumento adicional `--compact`". Pode-se adicionar nota em bullet ou parágrafo direto.
  - No Step 2, no bloco fast-path condition, adicionar instrução explícita: "Quando fast-path acionado, orchestrador DEVE incluir `Fast-path: true` no bloco <classification> do plan. Quando não acionado, omitir o campo (validate-plan aceita ausência como false)."
  - No bloco Plan Format (seção final do arquivo), documentar o campo opcional:
    - Atualizar o exemplo de <classification> mostrando `Fast-path: <true|false>` como linha opcional.
    - Atualizar a nota "Classification values" adicionando: "Fast-path: optional | true | false | when omitted, treated as false"
- Não alterar lógica operacional de clarify/questions/DA skip.

</tasks>

<execution>
**Wave 1** (paralelo): trim-map-conventions, add-compact-flag, tighten-init-phase, accept-fastpath-field, propagate-fastpath
</execution>

<criteria>
- [ ] map-conventions.ts output não contém mais "Function signatures" nem "Import clusters" em ## Patterns; Module boundaries top-5 preservado
- [ ] map-project.ts --compact produz output com tree max 3 níveis, sem Recent Commits, Dependencies top-5; sem --compact, output atual preservado
- [ ] init-phase.ts com plan Fast-path: true invoca map-project --compact e aplica whitelist de 5 seções; sem marker, comportamento atual intacto
- [ ] Task content com test.ts file ref OU palavra 'test'/'spec' inclui "## Testing" mesmo após remoção de 'testing' keyword
- [ ] validate-plan.ts aceita classification com Fast-path: true/false; rejeita outros valores; aceita ausência
- [ ] talk.md documenta uso de --compact em fast-path e emissão do marker no plan
- [ ] Plan Format em talk.md inclui campo Fast-path opcional em <classification>
- [ ] Build/typecheck passam em /home/bruno/dev/devorch
</criteria>
</phase1>
