# Plan: devorch v3 redesign

Design spec consolidado da conversa de redesign. Este doc é a fonte única que
agentes de implementação consomem — evita reinlining em briefings.

## Mission

Reduzir fricção em tarefas pequenas/médias preservando qualidade em tarefas
grandes. Colapsar 3 comandos em 1, com roteamento por modo. Guardião de
padrões da indústria ativo por default. Cerimônia proporcional ao escopo.

## Princípios v3 (9)

Substituem os 7 princípios atuais em `docs/PHILOSOPHY.md`. Delta explícito no
final do novo documento.

1. **Orchestrator stays focused, not small.** Com 1M context, coordenar inline
   é OK. "Leve" era sobre tokens; "focado" é sobre o que cabe ali — não
   poluir com implementação, sim centralizar dispatch e validação.

2. **Fresh context per subagent, with filter gates.** Cada subagent recebe
   contexto curado e isolado. Se o filtro por task devolver <3K ou >30K
   tokens, pausa e mostra ao humano — curadoria explícita, não cega.

3. **Mechanical outside the LLM, judgment inside.** Script vence em FS/git/
   parsing/hash/exec. LLM vence em classificação de intenção, enumeração
   de edge cases, detecção semântica, design. Classificação de triage é
   judgment — vai no Opus inline, não em script.

4. **Parallelism is earned by scope.** Paralelizar waves e explorações só
   quando o escopo paga. `quick`/`scoped` executam linear. `full` usa waves
   paralelas, explorações paralelas, satellites paralelos.

5. **Enumerate before; ask only real bifurcations.** Edge cases sempre
   enumerados em 3 buckets (óbvio-do-código, explícito-no-pedido,
   bifurcação). Transparência sempre. Pergunta só para bifurcação real.
   Gate único com "Nenhum"/"Todos"/"Números". Zero perguntas é válido.

6. **Code is contextual truth; industry is normative.** Código do repo mostra
   o que é; padrão da indústria mostra o que deveria. Convenção extraída do
   código entra como contexto, não como lei — substituível.

7. **Fail fast, fix with context.** Post-edit lint hook, check-project por
   fase, retry loop local antes de escalar. Intacto de v2.

8. **Guardian is default posture.** Em todos os modos, o orquestrador
   opera como senior. Silent quando código está correto; loud quando
   detecta heads-up crítico. Não ensina, redireciona.

9. **Ceremony proportional to scope.** `quick` pula plan/clarify/worktree.
   `scoped` pula plan formal, mantém enumeração. `full` faz tudo. Custo
   proporcional ao tamanho da tarefa.

## Comando unificado `/d`

Substitui conceitualmente `/devorch:talk` + `/devorch:build` + `/devorch:fix`.
Mantém `/devorch:worktrees` (list/merge/delete — útil independente).

### Invocação

```
/d "<descrição do que fazer>"
/d --quick "<...>"    # força quick, override
/d --full "<...>"     # força full, override
/d --resume           # retoma worktree ativo
```

### Fluxo por modo

**`quick`** (trivial edits, 1-3 arquivos, escopo óbvio)
1. Orquestrador classifica inline (Opus, com thinking curto) e justifica em 1 linha
2. Guardião varre rapidamente — se encontrar heads-up crítico, pausa e mostra
3. Executa edit direto
4. Post-edit lint hook protege
5. Commit curto `type(scope): description`
6. Fim

**`scoped`** (1 módulo, feature pequena ou fix com opções)
1. Orquestrador classifica + justifica
2. 1 Explore agent (thoroughness medium) em paralelo com leitura rápida do pedido
3. Guardião enumera edge cases → 3 buckets
4. Emite bloco de transparência:
   ```
   Edge cases considerados: N
   Resolvidos por convenção/código/pedido: M
   Bifurcações reais: K
   Heads up crítico: J

   Heads up:
   - <item> ... [opção A] [opção B] [skip]

   Bifurcações:
   1. <título>
      A) <opção> (recomendação se existe)
      B) <opção>
      Recomendação: A — <1 linha de motivo>
   2. ...

   Quais itens clarificar? [Nenhum / Todos / Números (ex: 1,3)]
   ```
5. `AskUserQuestion` único consolidando o gate
6. Executa com defaults/respostas
7. Post-edit lint hook
8. `check-project.ts --quick` no fim
9. Commit
10. Fim

**`full`** (multi-module, feature nova, refactor amplo)
1. Orquestrador classifica + justifica
2. Cria worktree imediato via `setup-worktree.ts` — plan mora dentro do worktree
3. 2-3 Explore agents paralelos com focos distintos
4. Guardião enumera edge cases → 3 buckets → bloco de transparência como scoped
5. Gate único para bifurcações
6. Emite plano estruturado com `<phases>`, `<waves>`, `<tasks>`, `<decisions>`
7. `validate-plan.ts` valida estrutura
8. Build por fase:
   - `init-phase.ts` retorna contexto filtrado por task
   - Gate de tamanho: se qualquer task devolve <3K ou >30K, pausa
   - Waves paralelas via Task tool (devorch-builder-deep)
   - Cada builder com contexto isolado (conventions slice + cache slice + code structure)
   - Post-edit lint hook ativo
   - `check-project.ts --quick` entre fases
9. Review adversarial final categorizado:
   - `security` — anti-patterns OWASP
   - `performance` — custo estimado, anti-patterns (N+1, full scan, polling)
   - `completeness` — spec vs entrega
   - `flags` — itens adjacentes fora de escopo → `.devorch/flags-<plan>.md`
10. Merge flow via `/devorch:worktrees merge`:
    - Rebase contra main
    - Re-check
    - Review leve do diff final vs plan
    - `--no-ff` preservando commits de fase
    - Cleanup worktree + archive plan

### Classificação de triage (Opus inline)

Bloco no prompt do comando instruindo:

```
Primeira ação: classifique o pedido em um de:
- quick — 1-3 arquivos conhecidos, ação clara, sem ambiguidade de design
- scoped — 1 módulo, feature/fix com opções legítimas, 1 explore basta
- full — multi-módulo, feature nova, refactor amplo, worktree justificável

Use thinking curto (~500-1000 tokens). Justifique em 1 linha. Flags
--quick/--full override humano.

Sinais de full: nova abstração, multi-repo, termo sem precedente no repo,
mudança cross-cutting (auth, DB schema, API shape).
Sinais de scoped: bug com múltiplas causas possíveis, endpoint novo em
módulo existente, feature pequena, refactor em 1 arquivo.
Sinais de quick: typo, rename, bugfix localizado, ajuste de config, edit
em arquivo claramente identificado.
```

### Papel de guardião (instrução inline, não library)

Bloco no prompt do comando:

```
Seu papel: senior engineer pair revisando trabalho de dev auto-didata
bem-intencionado, performance-first, que valoriza elegância arquitetural.

Antes de propor execução:
1. Avalie pedido + código adjacente contra padrões industriais em:
   - Segurança (OWASP top 10)
   - Performance (latência, custo, escalabilidade, cache tiers)
   - Arquitetura (separação, acoplamento, observabilidade)
   - Operações (falha, retry, idempotência)

2. Bucketize achados em:
   - heads-up crítico: resposta certa conhecida → redirect
   - bifurcação real: trade-off legítimo → apresentar
   - silêncio: correto → não comentar

3. Recomendações concretas: cite custo estimado (ordem de magnitude),
   nome do anti-pattern, alternativa em 1 linha.

4. NÃO ensine. Redirecione. Tom de pair senior: "por aqui, não por aqui".
   Explicação só se usuário perguntar.

Checklist de domínios para varrer (mnemônico):
auth · rate-limiting · input validation · error boundaries ·
caching · indexing · N+1 · pagination · realtime strategy ·
upload path · async/queue · observability · idempotency ·
secrets handling · cross-tenant isolation

Perfil do usuário (de .devorch/profile.yml se existir): priorities e
biases afetam ponderação de bifurcações. Em bifurcação com trade-off
performance vs simplicidade, mostre custo e deixe escolher — não
assuma a favor de simplicidade.
```

## Arquivos de config/state

### `.devorch/profile.yml` (opcional, global ou per-project)

```yaml
priorities: [performance, security, cost, dx]

biases:
  - prefer: stateless-clients
  - prefer: edge-processing
  - prefer: direct-storage-access
  - avoid: server-side-buffering
  - avoid: synchronous-workers
```

Orquestrador lê, passa como contexto no prompt do guardião. Ordem em
`priorities` define empate em bifurcações. `biases` são hints adicionais.

### `.devorch/flags-<plan>.md` (per-plan)

Criado durante review. Formato markdown:

```markdown
# Flags: <plan-name>

## api/orders.ts:88 — SQL concatenation
**Tipo**: security
**Severidade**: high
**Detecção**: db.query("SELECT * FROM orders WHERE id = " + req.params.id)
**Risco**: SQL injection (OWASP A03)
**Correção sugerida**: parameterized query
**Ação**: [ ] fix-now / [ ] new-plan / [ ] ciente-deixar

## api/upload.ts — proxy pattern
**Tipo**: performance
**Severidade**: medium
**Detecção**: worker processa upload grande no endpoint
**Custo estimado**: N workers × 30MB por sessão
**Alternativa**: signed URL direto
**Ação**: [ ] new-plan / [ ] skip
```

Usuário marca ação, devorch pode gerar plan separado se `new-plan`.

### `.devorch/standards-silenced.md` (per-project, auto)

Auto-atualizado após 3x "ciente-deixar" no mesmo flag:

```markdown
# Silenced flags

## api/legacy/*:*:sql-concat
Silenced at 2026-04-16. Reason: legacy code, migration planned separately.
Reactivate: delete this line.
```

Guardião consulta antes de emitir heads-up — items silenciados passam batido.

## Worktree policy

- `quick` → sem worktree (edit no cwd)
- `scoped` → sem worktree default; `--worktree` opt-in
- `full` → worktree obrigatório, criado ANTES do plan
- Naming: `.worktrees/<plan-name>` onde plan-name é kebab-case derivado do
  pedido inicial (~3-5 palavras)
- Branch: mesmo nome que o plan
- Merge: via `/devorch:worktrees merge <name>` — rebase → check → review →
  `--no-ff` → cleanup
- Alerta: worktree >3 dias + main avançou → guardião sugere rebase

## Migração: v3 alongside v2

Durante transição, `/d` coexiste com `/devorch:talk|build|fix`. Critérios:

- `/d` é o comando novo recomendado para tarefas diárias
- `/devorch:talk|build|fix` ficam funcionais para retomar plans v2 existentes
- README documenta os dois e sinaliza qual usar quando
- Quando `/d` estabilizar, v2 pode ser deprecado em versão major futura

Não deletar arquivos v2 nesta iteração.

## Escopo desta iteração

Entregáveis:

1. **`commands/d.md`** — novo comando unificado. Inclui todos os blocos
   descritos acima (triage inline, guardião, modos, gate UX, worktree
   policy). Target: ~300-400 linhas (vs 742 de talk.md — enxuto).

2. **`docs/PHILOSOPHY.md`** — reescrito com os 9 princípios v3. Inclui
   seção "Mudanças vs v2" explicitando delta. Preserva seção "When to
   Revisit This Document".

3. **`docs/PROFILE.md`** — spec do `.devorch/profile.yml` com exemplos,
   defaults, integração com guardião.

4. **`docs/FLAGS.md`** — spec do `.devorch/flags-<plan>.md` e
   `.devorch/standards-silenced.md` com formatos e lifecycle.

5. **`README.md`** — atualização sinalizando coexistência `/d` vs v2,
   novo fluxo recomendado, preservação de plans v2 ativos.

Fora do escopo (próximas iterações):

- Implementação de `/d` executando end-to-end (precisa ajustes em scripts)
- Deprecação final de `/devorch:talk|build|fix`
- Changes em `init-phase.ts` para suportar gates de filtro
- Changes em `validate-plan.ts` para formato v3
- Novo script de merge-worktree com rebase-first + review leve
- Testing end-to-end em projetos reais

## Estrutura de entrega

Os entregáveis nascem no worktree `.worktrees/devorch-v3-redesign/`.
Agentes escrevem direto. Orquestrador revisa + commit por artefato.
Merge para master só após validação manual pelo Bruno.
