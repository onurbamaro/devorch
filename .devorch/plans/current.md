# Plan: devorch v2 — 3 comandos com Agent Teams

<description>
Redesenhar devorch de 8 comandos para 3 focados: /devorch:talk (conversa + exploração + plano),
/devorch:fix (fix pontual com investigação), /devorch:build (execução por fases com verificação
final pesada). Agent Teams como modo padrão sem gate. Verificações baratas per-fase, pesada
apenas no final. Auto-fix de findings triviais sem interação.
</description>

<objective>
Devorch v2 funcional com 3 comandos (talk, fix, build + worktrees mantido), Agent Teams integrado
nativamente em cada ponto de exploração/investigação/review, verificações baratas per-fase e pesada
no final, auto-fix de findings sem interação do usuário para issues triviais.
</objective>

<classification>
Type: refactor
Complexity: complex
Risk: high
</classification>

<decisions>
Gate do /devorch:fix → classificação inteligente pelo Claude, não regra rígida de arquivos
Verificação per-fase → apenas check-project.ts --no-test + run-validation.ts (em paralelo, sem validator agent)
Verificação final → check-project.ts completo + Agent Teams adversarial (3 revisores)
Auto-fix → findings triviais corrigidos sem interação; complexos geram prompt completo para /devorch:fix ou /devorch:talk
Agent Teams → sempre ativo, sem gate de flag experimental; fallback para Task agents paralelos se TeamCreate falhar
Builders → continuam como Task agents paralelos (sem Agent Teams na implementação)
/devorch:debug → removido (funcionalidade absorvida pelo /devorch:fix)
Validator agent → removido (verificação per-fase é automática via scripts)
Orchestrator fix.md → pode ler/editar source code diretamente (fix é pequeno, não precisa de builder agent)
Agent Teams pattern → Task agents paralelos com role instructions para exploração (mais rápido, sem overhead de coordenação); TeamCreate para review adversarial no build final se desejado
</decisions>

<problem-statement>
Devorch atual tem 8 comandos com routing complexo num entry point unificado, Agent Teams gated
atrás de flag experimental, e verificação per-fase cara (validator agent + run-validation a cada fase).
Tempo de execução alto e complexidade desnecessária. O Claude Code puro é rápido mas pode pecar
na entrega por falta de bom plano e verificações — devorch deve complementar com bom plano e boas
verificações, não adicionar overhead.
</problem-statement>

<solution-approach>
1. Substituir entry point unificado por 3 comandos explícitos: talk (conversa→plano), fix (investigação→correção), build (execução→verificação)
2. Agent Teams integrado nativamente: exploração com roles especializados em talk/fix, adversarial review no build final
3. Verificação per-fase reduzida a check-project.ts --no-test + run-validation.ts (paralelo) — sem validator agent
4. Verificação final concentrada: check-project.ts full + cross-phase Explore + adversarial review + auto-fix
5. fix.md opera direto (sem builder agent) — investiga com agents, executa fix, verifica em paralelo
6. Remover: devorch.md, check-implementation.md, debug.md, review.md, explore-deep.md, build-tests.md, plan-tests.md, devorch-validator.md, check-agent-teams.ts, hash-plan.ts, extract-criteria.ts, verify-build.ts
7. install.ts atualizado para nova estrutura de arquivos
</solution-approach>

<relevant-files>
- `commands/devorch.md` — entry point atual; conteúdo reutilizado em talk.md (Plan Format, context loading, conventions, new project detection)
- `commands/build.md` — build atual; reescrito com final check integrado
- `commands/check-implementation.md` — lógica de verificação final integrada no build.md
- `commands/debug.md` — padrão de investigação com Agent Teams reutilizado em fix.md
- `commands/explore-deep.md` — padrão de exploração com Agent Teams reutilizado em talk.md
- `commands/review.md` — padrão de review adversarial reutilizado no final check do build.md
- `commands/build-tests.md` — removido
- `commands/plan-tests.md` — removido
- `agents/devorch-builder.md` — mantido com ajustes menores
- `agents/devorch-validator.md` — removido
- `templates/build-phase.md` — atualizado (sem validator, sem run-validation por wave)
- `install.ts` — atualizado para nova lista de arquivos
- `scripts/check-agent-teams.ts` — removido
- `scripts/hash-plan.ts` — removido
- `scripts/extract-criteria.ts` — removido
- `scripts/verify-build.ts` — removido

<new-files>
- `commands/talk.md` — /devorch:talk: conversa + exploração + clarificação + plano + worktree
- `commands/fix.md` — /devorch:fix: classificação + investigação + fix + verificação
</new-files>
</relevant-files>

<!-- ═══════════════════════════════════════════════════════════════════ -->

<phase1 name="New Commands">
<goal>Criar talk.md e fix.md — os dois novos comandos do devorch v2</goal>

<tasks>
#### 1. Create talk.md
- **ID**: create-talk
- **Assigned To**: builder-1

Criar `commands/talk.md` — o comando de conversa, exploração e planejamento do devorch v2.

**Frontmatter YAML:**
```yaml
---
description: "Conversa + exploração com Agent Teams + plano estruturado"
argument-hint: "<o que quer fazer, explorar ou discutir>"
model: opus
disallowed-tools: EnterPlanMode
---
```

**Estrutura do arquivo (seguir esta ordem de seções):**

**Input**: $ARGUMENTS. Se vazio, perguntar ao usuário.

**Step 1 — Load context**: Reutilizar lógica do devorch.md atual (linhas 19-85):
- `map-project.ts --persist` para tech stack
- New project detection (discovery mode: product + tech + architecture) — copiar lógica inteira do devorch.md atual
- CONVENTIONS.md loading/generation com Explore agents — copiar lógica inteira do devorch.md atual
- Legacy plan migration com archive-plan.ts — copiar lógica inteira do devorch.md atual
- Staleness check de conventions vs package.json — copiar lógica do devorch.md atual

**Step 2 — Explore with Agent Teams**: NOVO — substituir a exploração simples do devorch.md atual.

Analisar o $ARGUMENTS e determinar a composição do time de exploração:

**Template teams** (usar quando o tipo de tarefa é claro):

| Tipo | Roles |
|---|---|
| Feature/Enhancement | architecture-explorer (como encaixa na arquitetura), risk-assessor (o que pode dar errado, edge cases), pattern-analyst (padrões existentes a seguir) |
| Refactor | structure-analyst (estrutura atual + dependências), impact-assessor (blast radius), pattern-proposer (padrões alvo baseados nas convenções) |
| Bug complexo | 2-3 investigadores, cada um com hipótese distinta sobre a causa raiz |
| New project | skip (não há código para explorar; usar discovery mode do Step 1) |

**Dynamic team** (quando nenhum template se aplica):

Instruir o Claude a pensar:
```
Analise a tarefa e responda mentalmente:
1. Que dimensões esta tarefa tem? (UI, dados, performance, segurança, UX, infraestrutura...)
2. Que perspectivas distintas encontrariam problemas diferentes?
3. Que tensões existem? (performance vs legibilidade, flexibilidade vs simplicidade...)

Crie 2-4 agentes onde:
- Cada agente tem foco DISTINTO dos outros
- Nenhum agente repete o trabalho de outro
- Juntos cobrem ≥90% dos riscos e áreas da tarefa
- Cada agente sabe o que os outros estão cobrindo
```

**Execução**: Lançar todos os exploradores como Task calls paralelas com `subagent_type="Explore"` em uma única mensagem. Cada prompt inclui: role, foco específico, $ARGUMENTS, CONVENTIONS.md (se existir). NÃO usar TeamCreate para exploração — Task agents paralelos são mais rápidos e exploração não precisa de coordenação inter-agente.

Após todos retornarem: escrever findings combinados em `.devorch/explore-cache.md` com formato:
```markdown
# Explore Cache
Generated: <ISO timestamp>

## <area-name-1>
<summary from explorer 1>

## <area-name-2>
<summary from explorer 2>
```

**Step 3 — Clarify with the user**: Reutilizar lógica do devorch.md atual P4 (linhas 183-207) mas com estas adições:
- Cobrir explicitamente gray areas que os exploradores identificaram
- Perguntar sobre coisas que o usuário provavelmente não pensou (descobertas pelos exploradores)
- Mandatory — nunca pular este step
- AskUserQuestion com 2-4 opções por pergunta, rounds ilimitados
- Front-load recommended option com "(Recommended)"
- Continuar até ZERO ambiguidade
- Tópicos a cobrir: scope, approach, constraints, behavior, edge cases, priority, integration, naming

**Step 4 — Deep exploration (conditional)**: Se respostas do usuário revelaram novas áreas, lançar Explore agents adicionais. Append ao explore-cache.md.

**Step 5 — Propose plan**: Usar AskUserQuestion:
- Opção 1: "Gerar plano e worktree" (Recommended)
- Opção 2: "Continuar explorando"
- Opção 3: "Encerrar — tenho o que precisava"

Se opção 2: voltar ao Step 2 com novo foco.
Se opção 3: resumir findings e encerrar.
Se opção 1: continuar para Step 6.

**Step 6 — Design solution** (medium/complex apenas): Pensar: problema central, abordagem, alternativas, riscos e mitigações.

**Step 7 — Create plan**:
1. Derivar kebab-case name do nome descritivo do plano
2. `bun $CLAUDE_HOME/devorch-scripts/setup-worktree.ts --name <kebab-name>`. Parse JSON para `worktreePath`.
3. Escrever plano em `<worktreePath>/.devorch/plans/current.md` seguindo o **Plan Format** abaixo.
4. Copiar `.devorch/CONVENTIONS.md` para `<worktreePath>/.devorch/CONVENTIONS.md` (se existir).
5. NÃO copiar explore-cache.md — fica no main repo. Worktrees leem cache via `--cache-root`.
6. Set `planPath = <worktreePath>/.devorch/plans/current.md`.

**Step 8 — Validate**: `bun $CLAUDE_HOME/devorch-scripts/validate-plan.ts --plan <planPath>`. Fix issues if blocked.

**Step 9 — Reset state**: Deletar `<worktreePath>/.devorch/state.md` se existir.

**Step 10 — Commit**:
- Na worktree branch:
  ```bash
  git -C <worktreePath> add .devorch/plans/current.md .devorch/CONVENTIONS.md
  git -C <worktreePath> commit -m "chore(devorch): plan — <descriptive plan name>"
  ```
- No main repo (se explore-cache ou CONVENTIONS foram alterados):
  - Stage `.devorch/explore-cache.md`, `.devorch/CONVENTIONS.md`
  - Commit: `chore(devorch): add worktree for <plan name>`

**Step 11 — Suggest next**: Reportar:
```
Plano criado na worktree: <worktreePath> (branch: <branch>)
/clear
/devorch:build --plan <name>
```
Explicar: o planejamento consumiu contexto significativo — /clear libera antes do build.

---

## Parallelization Rules

Maximize parallel execution without losing quality:

- **Break work into independent units.** If a large task can be split into two tasks that touch different files, split it.
- **Group independent tasks into the same wave.** All tasks in a wave run as parallel agents.
- **Only create sequential waves when truly necessary**: task B reads output of task A, or both modify the same file.
- **Validation is always the last wave**, after all build tasks complete.
- **Aim for wide waves**: 3 parallel tasks in 1 wave is better than 3 sequential waves of 1 task.

Quality guardrails:
- Two tasks in the same wave must NOT modify the same file.
- Two tasks in the same wave must NOT have a producer/consumer relationship.
- Each task must be self-contained — a builder should complete it without needing another builder's uncommitted work.

## Sizing Rules

- Max **5 tasks** per phase. Each completable by one builder.
- Each phase MUST fit in 1 phase execution without context compaction.
- Prefer more smaller phases over fewer large ones.

## Plan Format

Copy the **Plan Format** section, **Plan Format Rules** subsection, from the current `commands/devorch.md` file (lines 353-453) exactly as-is into talk.md. This section defines the XML tag structure for plans — it is the complete specification that builders and scripts depend on. Do NOT modify the format; copy it verbatim.

## Rules

- Do not narrate actions. Execute directly without preamble.
- **PLANNING AND ROUTING ONLY.** Do not build, write code, or deploy builder agents.
- **The orchestrator NEVER reads source code files directly.** Use the **Task tool call** with `subagent_type="Explore"` for all codebase exploration. The orchestrator only reads devorch files (`.devorch/*`) and Explore agent results. Use Grep directly only for quantification (counting matches).
- **Explore agents focus on source code.** Devorch state files (`.devorch/*`) are read by the orchestrator, not by Explore agents.
- Always validate the plan before reporting.
- Create `.devorch/plans/` directory if needed.
- All user-facing text in Portuguese must use correct pt-BR accentuation and grammar.
- No Task agents except Explore (for understanding code).

#### 2. Create fix.md
- **ID**: create-fix
- **Assigned To**: builder-2

Criar `commands/fix.md` — o comando de fix/debug pontual do devorch v2.

**Frontmatter YAML:**
```yaml
---
description: "Fix/debug pontual com investigação Agent Teams"
argument-hint: "<descrição do bug ou tarefa pontual>"
model: opus
---
```

**Estrutura do arquivo:**

**Input**: $ARGUMENTS. Se vazio, perguntar ao usuário.

**Step 1 — Load context**:
- `bun $CLAUDE_HOME/devorch-scripts/map-project.ts` (inline, sem --persist) para tech stack
- Ler `.devorch/CONVENTIONS.md` se existir

**Step 2 — Classify**: O Claude avalia a tarefa e classifica:

**FIX** (escopo contido): implementável sem parar para pensar em fases. Exemplos:
- Renomear tipo usado em vários arquivos (mecânico, mesmo que toque 10 files)
- Corrigir bug com causa raiz clara
- Adicionar validação faltando
- Ajustar comportamento conforme spec
- Qualquer mudança onde o "como" é óbvio e não há decisões de design

**TALK** (precisa de plano): requer decisões de design, múltiplas abordagens possíveis, ou impacto estrutural. Exemplos:
- Feature nova com múltiplos componentes
- Refactor que muda a arquitetura
- Mudança que afeta APIs públicas de forma não-trivial

Se **TALK**: gerar prompt completo para /devorch:talk com todo contexto da investigação feita até aqui. Formato:
```
Classificado como tarefa de planejamento.

/devorch:talk <prompt detalhado incluindo: o que foi pedido, o que a investigação descobriu, áreas afetadas, decisões necessárias>
```
Parar execução.

Se **FIX**: continuar.

**Step 3 — Investigate with Agent Teams**: Lançar 2-3 Explore agents paralelos (Task com subagent_type="Explore"), cada um com um foco distinto:

- Se bug: cada agente testa uma hipótese diferente sobre a causa raiz. Hipóteses devem ser específicas e falsificáveis (inspirado no debug.md atual).
- Se task: cada agente explora um aspecto diferente (código afetado, padrões existentes, testes existentes)

Coletar findings de todos os agentes.

**Step 4 — Clarify (conditional)**: Se ambíguo após investigação: 1-2 rounds rápidos de AskUserQuestion. Máximo 2 rounds — fix deve ser rápido.

**Step 5 — Execute fix**: O orchestrator implementa diretamente usando Edit/Write tools. NÃO spawnar builder agent — fix é pequeno e o overhead não compensa. Seguir CONVENTIONS.md.

**Step 6 — Verify (all parallel, single message)**: Lançar TUDO em paralelo numa única mensagem:

- `bun $CLAUDE_HOME/devorch-scripts/check-project.ts` — Bash com run_in_background=true (full, com testes)
- 1-2 review agents (condicionais — lançar se: área de segurança, código compartilhado, ou lógica complexa) — Task com subagent_type="Explore", foreground, paralelo. Cada review agent recebe: os arquivos modificados (git diff), a descrição do fix, CONVENTIONS.md. Foco: o fix introduziu regressões? Edge cases não tratados? Violação de padrões?

Coletar todos os resultados após completarem.

**Step 7 — Auto-fix**: Para cada finding dos review agents:
- Se fix trivial (import faltando, edge case óbvio, lint issue): corrigir direto com Edit, sem perguntar
- Se complexo: reportar ao usuário com contexto e sugestão

Re-rodar check-project.ts se houve auto-fixes.

**Step 8 — Commit**: Commit convencional:
- `feat|fix|refactor|chore(scope): description`
- Stage apenas arquivos alterados (não git add .)

**Step 9 — Report**: Resumo conciso: o que mudou, commit hash, resultado dos checks.

**Rules**:
- Não narrar ações. Executar direto.
- Fix.md PODE ler e editar source code diretamente (diferente de talk/build que delegam).
- Máximo paralelismo na verificação.
- Se check-project.ts falha e o fix é óbvio: corrigir e re-rodar.
- Se check-project.ts falha e o fix não é óbvio: reportar ao usuário.
- Português com acentuação correta.
</tasks>

<execution>
**Wave 1** (parallel): create-talk, create-fix
</execution>

<criteria>
- [ ] talk.md existe em commands/ com frontmatter válido
- [ ] talk.md contém: context loading, Agent Teams exploration, clarification, plan generation, worktree setup, Plan Format section
- [ ] talk.md NÃO contém Quick Path (isso é fix.md)
- [ ] talk.md NÃO referencia check-agent-teams.ts (flag gate removido)
- [ ] fix.md existe em commands/ com frontmatter válido
- [ ] fix.md contém: intelligent classification, Agent Teams investigation, direct execution, parallel verification, auto-fix
- [ ] fix.md NÃO spawna builder agents (executa fix direto)
- [ ] fix.md NÃO referencia check-agent-teams.ts
- [ ] Ambos seguem a regra "não narrar ações"
</criteria>

<validation>
- `test -f commands/talk.md && echo "talk.md exists"` — arquivo criado
- `test -f commands/fix.md && echo "fix.md exists"` — arquivo criado
- `grep -c "check-agent-teams" commands/talk.md commands/fix.md | grep -v ":0$" && echo "FAIL: still references check-agent-teams" || echo "PASS: no check-agent-teams references"` — sem referências ao script removido
- `grep -l "EnterPlanMode" commands/talk.md` — talk.md desabilita EnterPlanMode
</validation>

<handoff>
Dois novos arquivos de comando criados: talk.md (conversa + exploração + plano) e fix.md (fix pontual).
Phase 2 precisa: reescrever build.md para integrar o final check (de check-implementation.md),
atualizar build-phase.md para remover o validator agent e simplificar verificação per-fase,
e atualizar devorch-builder.md para remover referências ao validator.
</handoff>
</phase1>

<!-- ═══════════════════════════════════════════════════════════════════ -->

<phase2 name="Build System Rewrite">
<goal>Reescrever build.md com final check integrado e simplificar build-phase.md sem validator</goal>

<tasks>
#### 1. Rewrite build.md
- **ID**: rewrite-build
- **Assigned To**: builder-1

Reescrever `commands/build.md` — integrar a verificação final (atualmente em check-implementation.md) e simplificar.

**Frontmatter YAML** (manter igual):
```yaml
---
description: Executes all remaining phases of the current devorch plan
argument-hint: [--plan <name>]
model: opus
---
```

**Step 0 — Resolve plan path**: Manter EXATAMENTE a lógica atual do build.md (linhas 20-38). Nenhuma mudança.

**Step 1 — Determine scope**: Manter EXATAMENTE a lógica atual (linhas 41-49). Nenhuma mudança.

**Step 2 — Phase loop**: Manter a lógica atual (linhas 53-61) mas REMOVER o Step 3 atual que lê check-implementation.md. O phase loop continua igual: para cada fase, lançar Task com build-phase.md, verificar state.md após retorno.

**Step 3 — Final verification (NEW — substitui check-implementation.md inteiro)**:

Após todas as fases completarem com sucesso, executar verificação pesada INLINE (não como Task — para que agents sejam first-level calls):

**3a. Determine changed files**: `git -C <projectRoot> diff --name-only` contra baseline:
- Se todas as fases complete: diff contra parent do primeiro commit `phase(1):`
- Se parcial: diff até última fase completa
- Fallback: diff contra commit do plano (`chore(devorch): plan`)

**3b. Launch everything parallel (single message)**:

Lançar TUDO em paralelo numa única mensagem:

1. `bun $CLAUDE_HOME/devorch-scripts/check-project.ts <projectRoot>` — Bash background (full, WITH tests)
2. Cross-phase Explore agent — Task foreground (subagent_type="Explore"):
   - Prompt: changed files list, new-files list, phase goals + handoffs de cada fase, CONVENTIONS.md
   - Foco APENAS em files do git diff
   - Verificar: imports resolvem, sem orphan exports, sem TODO/FIXME/HACK de builders, type consistency, sem dead code, handoff contracts honrados
   - Report com file:line evidence
3. 3 adversarial review agents — Task foreground, paralelos na mesma mensagem (subagent_type="Explore"):
   - Cada agente recebe: objective + description do plano (NÃO o código fonte), CONVENTIONS.md, lista de changed files
   - Cada um EXPLORA O CÓDIGO INDEPENDENTEMENTE — como se não conhecesse a implementação
   - **security-reviewer**: vulnerabilidades, injection, auth issues, data exposure, secrets
   - **quality-reviewer**: edge cases, error handling, correctness, maintainability
   - **completeness-reviewer**: tudo do plano foi implementado? falta algo? comportamento matches spec?

**3c. Synthesize and dispatch**:

Coletar resultados de: check-project.ts, cross-phase Explore, 3 reviewers.

Para cada finding:
- **Trivial** (fix auto-evidente, sem ambiguidade): corrigir direto com Edit tool. Exemplos: TODO/FIXME sobrando, import não usado, typo, formatting.
- **Complexo** (múltiplos arquivos, decisão de design, regressão potencial): NÃO corrigir. Gerar prompt completo:
  ```
  /devorch:fix <descrição detalhada do issue, incluindo: o que está errado, quais arquivos, o que os reviewers encontraram, sugestão de abordagem>
  ```

Após corrigir triviais:
- Commit: `fix(check): <descrição concisa das correções>`
- Re-rodar check-project.ts se houve correções

**3d. Report**:
```
## Verificação Final: <plan name>

### Checks Automatizados
Lint: ✅/❌  Typecheck: ✅/❌  Build: ✅/❌  Tests: ✅/❌ (N/M)

### Integração Cross-phase
<findings do Explore agent ou "✅ OK">

### Review Adversarial
Security: <findings ou "✅ clean">
Quality: <findings ou "✅ clean">
Completeness: <findings ou "✅ clean">

### Correções Automáticas
<N issues triviais corrigidos inline> (ou "Nenhum")

### Issues Pendentes
<prompts /devorch:fix gerados> (ou "Nenhum")

### Verdict: PASS / PASS com N issues pendentes / FAIL
```

**Step 4 — Merge worktree**: Manter EXATAMENTE a lógica atual (linhas 73-92 do build.md). Nenhuma mudança.

**Rules** (manter atuais + adicionar):
- Não narrar ações. Executar direto.
- Fases rodam sequencialmente — cada uma em Task agent com contexto limpo.
- Parar na primeira falha. Reportar qual fase falhou.
- Orchestrator só lê state.md e planPath entre fases.
- Context discipline: build é supervisor fino.
- NOVO: Final verification roda INLINE (não como Task) para que Explore/review agents sejam first-level Task calls.
- NOVO: Auto-fix findings triviais sem interação. Só escalar complexos com prompt /devorch:fix.

#### 2. Update build-phase.md
- **ID**: update-build-phase
- **Assigned To**: builder-2

Atualizar `templates/build-phase.md` — remover validator agent e simplificar verificação per-fase.

**Mudanças específicas no build-phase.md atual:**

**Manter steps 1-3** (init-phase, explore, deploy builders) — NENHUMA alteração.

**Step 4 — Validate phase code**: MANTER mas ajustar para rodar em paralelo com step 5. Continua sendo `check-project.ts <projectRoot> --no-test` em background.

**Step 5 — Run validation commands**: MANTER mas ajustar para rodar em paralelo com step 4. Continua sendo `run-validation.ts --plan ... --phase N`.

**Steps 4+5 em paralelo**: Lançar ambos numa única mensagem (step 4 em Bash background, step 5 em Bash background). Coletar resultados após ambos completarem.

Avaliar resultados combinados:
- Se check-project.ts lint/typecheck falham em arquivos desta fase: fix inline com Edit e retry 1x
- Se run-validation.ts falha: log warning e continuar (final check do build.md pegará)
- Se tudo passa: prosseguir

**REMOVER Step 6 inteiro** (Deploy validator) — NÃO mais spawnar devorch-validator agent. Toda a verificação per-fase é automática via scripts (steps 4-5). Sem agente validator.

**Renumerar steps subsequentes**: O que era step 7 (phase commit) vira step 6. Step 8 (cache) vira 7. Step 9 (state) vira 8. Step 10 (report) vira 9.

**Ajustar instrução dos builders no step 3**: Remover qualquer referência a "validator will verify" ou "validation wave" nas instruções passadas aos builders.

**Manter tudo o mais**: init-phase.ts, explore logic, builder deployment, commit, cache invalidation, state update, report.

#### 3. Update devorch-builder.md
- **ID**: update-builder
- **Assigned To**: builder-3

Atualizar `agents/devorch-builder.md` — ajustes menores para alinhar com v2.

**Mudanças:**
- Remover qualquer referência a "validator", "validation wave", ou "devorch-validator" do workflow e rules
- O resto do arquivo fica EXATAMENTE igual — builder funciona bem como está
- Manter hooks PostToolUse (post-edit-lint)
- Manter Red Flags table
- Manter todas as rules
- Manter workflow steps
</tasks>

<execution>
**Wave 1** (parallel): rewrite-build, update-build-phase, update-builder
</execution>

<criteria>
- [ ] build.md contém final verification integrado (não referencia check-implementation.md)
- [ ] build.md final verification lança check-project.ts + cross-phase Explore + 3 adversarial reviewers em paralelo
- [ ] build.md final verification auto-fixa findings triviais sem interação
- [ ] build.md final verification gera /devorch:fix prompt para findings complexos
- [ ] build-phase.md NÃO spawna devorch-validator agent
- [ ] build-phase.md roda check-project.ts --no-test + run-validation.ts em paralelo
- [ ] build-phase.md mantém init-phase, explore, builders, commit, cache, state steps
- [ ] devorch-builder.md não referencia "validator"
</criteria>

<validation>
- `grep -c "check-implementation" commands/build.md | grep "^0$" && echo "PASS" || echo "FAIL: still references check-implementation"` — sem referência a check-implementation
- `grep -c "devorch-validator" templates/build-phase.md | grep "^0$" && echo "PASS" || echo "FAIL: still references validator"` — sem validator no template
- `grep -c "devorch-validator" agents/devorch-builder.md | grep "^0$" && echo "PASS" || echo "FAIL: builder references validator"` — sem validator no builder
- `grep "adversarial\|security-reviewer\|quality-reviewer\|completeness-reviewer" commands/build.md && echo "PASS: has adversarial review" || echo "FAIL"` — build tem adversarial review
</validation>

<handoff>
Build system reescrito com final check integrado e verificação per-fase simplificada.
Phase 3 precisa: remover todos os arquivos deprecated (commands, agents, scripts) e
atualizar install.ts para a nova estrutura. Arquivos a remover: devorch.md,
check-implementation.md, debug.md, review.md, explore-deep.md, build-tests.md, plan-tests.md,
devorch-validator.md, check-agent-teams.ts, hash-plan.ts, extract-criteria.ts, verify-build.ts.
</handoff>
</phase2>

<!-- ═══════════════════════════════════════════════════════════════════ -->

<phase3 name="Cleanup and Install">
<goal>Remover arquivos deprecated e atualizar install.ts para a nova estrutura v2</goal>

<tasks>
#### 1. Remove deprecated files
- **ID**: remove-deprecated
- **Assigned To**: builder-1

Deletar os seguintes arquivos usando `git rm`:

**Commands (7 arquivos):**
- `commands/devorch.md` — substituído por talk.md
- `commands/check-implementation.md` — integrado no build.md
- `commands/debug.md` — funcionalidade no fix.md
- `commands/review.md` — funcionalidade no build.md final check
- `commands/explore-deep.md` — funcionalidade no talk.md
- `commands/build-tests.md` — removido (não usado)
- `commands/plan-tests.md` — removido (não usado)

**Agents (1 arquivo):**
- `agents/devorch-validator.md` — verificação per-fase agora automática

**Scripts (4 arquivos):**
- `scripts/check-agent-teams.ts` — Agent Teams sem gate
- `scripts/hash-plan.ts` — overhead sem benefício
- `scripts/extract-criteria.ts` — lógica movida para final check inline
- `scripts/verify-build.ts` — lógica movida para final check inline

Usar `git rm` para cada arquivo para que a remoção seja tracked pelo git.
Commit: `chore(devorch): remove deprecated v1 files`

#### 2. Update install.ts
- **ID**: update-install
- **Assigned To**: builder-2

Atualizar `install.ts` para refletir a nova estrutura v2:

**Mudança 1 — Remover exclude do commands target**: No array `targets`, o item com `label: "commands"` tem `exclude: ["devorch.md"]`. Remover o `exclude` property inteiro — não há mais devorch.md para excluir.

**Mudança 2 — Remover bloco root devorch.md**: Remover o bloco inteiro (linhas 84-94) que copia `commands/devorch.md` para root level (`~/.claude/commands/devorch.md`). Não há mais `/devorch` root command — apenas subcommands (/devorch:talk, /devorch:fix, /devorch:build, /devorch:worktrees).

**Mudança 3 — Atualizar mensagem final**: Mudar `"Run /devorch in any project to get started."` para `"Run /devorch:talk in any project to get started."`.

**Nenhuma outra mudança necessária**: Como install.ts limpa o dest com `rmSync(dest, { recursive: true })` antes de copiar, os scripts/agents/commands deletados na task 1 simplesmente não serão copiados para ~/.claude/. A limpeza automática cuida disso.

Commit: `chore(devorch): update installer for v2 structure`
</tasks>

<execution>
**Wave 1**: remove-deprecated
**Wave 2** (after wave 1): update-install
</execution>

<criteria>
- [ ] Todos os 12 arquivos deprecated foram removidos via git rm
- [ ] install.ts não copia devorch.md para root level
- [ ] install.ts não tem exclude para devorch.md
- [ ] install.ts mensagem final referencia /devorch:talk
- [ ] Nenhum arquivo restante referencia check-agent-teams.ts, hash-plan.ts, extract-criteria.ts, verify-build.ts, ou devorch-validator
</criteria>

<validation>
- `test ! -f commands/devorch.md && echo "PASS" || echo "FAIL: devorch.md still exists"` — entry point removido
- `test ! -f agents/devorch-validator.md && echo "PASS" || echo "FAIL: validator still exists"` — validator removido
- `test ! -f scripts/check-agent-teams.ts && echo "PASS" || echo "FAIL: check-agent-teams still exists"` — script removido
- `test ! -f scripts/hash-plan.ts && echo "PASS" || echo "FAIL"` — script removido
- `test ! -f scripts/extract-criteria.ts && echo "PASS" || echo "FAIL"` — script removido
- `test ! -f scripts/verify-build.ts && echo "PASS" || echo "FAIL"` — script removido
- `grep "devorch:talk" install.ts && echo "PASS: install references talk" || echo "FAIL"` — install atualizado
- `grep -c "commands/devorch.md" install.ts | grep "^0$" && echo "PASS" || echo "FAIL: install still references root devorch.md"` — root copy removido
</validation>
</phase3>
