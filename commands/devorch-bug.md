---
description: "Variante de /devorch focada em bug — repro/causa raiz, teste de regressão, sintoma-vs-causa"
argument-hint: "[--resume] <descrição do bug>"
model: opus
effort: xhigh
disallowed-tools: EnterPlanMode
---

Variante focada em bug do `/devorch`. Mesmo pipeline (worktree → discovery → plan → build → gates → merge), com Stage 1 triangulando causa raiz em vez de mapear superfície de build, Stage 1.5 bifurcando sintoma-vs-causa, Stage 2 exigindo teste de regressão falhando antes da impl, e Stage 4.5 invertendo o default do test triage.

Use quando o trabalho é "consertar bug X" e não "adicionar feature Y". Para bugs triviais (literal errado, typo, off-by-one óbvio) pule os dois comandos e use Claude Code vanilla — a cerimônia não paga.

## Base pipeline

Leia `$CLAUDE_HOME/commands/devorch.md` integralmente e siga o pipeline ponta a ponta, aplicando os overrides abaixo nos estágios marcados. Onde este arquivo descreve override, use o override; nos demais estágios siga `/devorch` verbatim.

A semântica de `$ARGUMENTS`, a flag `--resume`, o worktree setup (Stage 0/0.5), o build scheduler (Stage 3 base), o gotcha capture, o flow friction capture, a unified gate UX e a lógica de merge (Stage 5) são iguais.

## Stage 1 override — Foco da discovery

Os papéis dos Explore agents mudam para triangular a causa raiz em vez de mapear uma área de build:

- **Agent 1 — repro**: localizar o code path que o sintoma atravessa. O summary deve incluir o ponto de entrada (`file:line` onde o bug se torna observável), o valor/estado ruim, e o call chain até ali. Thoroughness `very thorough` quando o sintoma é vago.
- **Agent 2 — root-cause**: rastrear de trás pra frente do ponto de repro até o **primeiro** lugar onde a invariante quebra (não o frame que crasha). Summary inclui o `file:line` causal e um parágrafo curto explicando por que a invariante falha.
- **Agent 3 — blast-radius** (opcional): quando o arquivo da causa raiz é consumido por 3+ call sites, lance este agent para enumerar consumidores e flaggar os que já têm workarounds (defensive checks, fallbacks). Pule quando o blast radius é obviamente pequeno (1-2 call sites).

Cap rígido: 3 agents (mesmo de `/devorch`).

Cada prompt continua incluindo `Working directory: <worktreePath>`, slice escopado do `projectMap`, gotchas filtrados, profile priorities e sibling repos hint conforme `/devorch` Stage 1b — só os papéis mudam, a montagem do prompt não.

Persista findings em `<worktreePath>/.devorch/cache/explore.json` exatamente como em `/devorch` Stage 1c — mesmo shape, o campo `agent` usa `repro` / `root-cause` / `blast-radius`.

## Stage 1.5 override — Framing do guardian

Rode o guardian role inline (mesma checklist de domínios de `/devorch`), mas a bifurcação canônica em bug-mode é **sintoma vs causa**:

- **A. Sintoma**: guardar no consumidor (validar input, fallback, defensive check). Localizado, baixo blast radius, mas o defeito continua vivo no producer.
- **B. Causa**: corrigir o producer ou o contrato que gera estado ruim. Blast radius maior, possivelmente toca outros consumidores, mas mata o defeito.

Emita esta bifurcação **sempre** que o ponto de repro (Agent 1) e o ponto de causa raiz (Agent 2) ficarem em módulos diferentes. Se forem o mesmo ponto, pule — não há bifurcação real. Recomendação default é B; marque A como recomendada apenas quando (1) a causa raiz está em código de terceiro/compartilhado que você não pode mexer, (2) o contrato do producer é intencionalmente permissivo, ou (3) o blast radius torna B genuinamente arriscado para o slice atual.

Outros heads-ups do guardian (auth, perf, arquitetura, ops) aplicam normalmente e entram no mesmo unified gate. A contagem de buckets (resolvidos / bifurcações / heads-ups) e o skip-when-silent (`K + J == 0`) funcionam idênticos.

## Stage 2 override — Shape do plano

- **Ordem teste-primeiro**: quando `hasTests=true` e o bug toca business logic, o primeiro phase do plano contém **uma única task** que escreve um teste de regressão falhando (`**Files**`: apenas o arquivo de teste). O phase seguinte contém a task de impl, com `<depends-on>` apontando para o phase do teste. NÃO bundle teste + impl em uma task só — manter sequencial garante que o builder do teste confirme a falha antes de commitar e que o phase de impl tenha sinal binário (teste vermelho → verde).
- **Plano enxuto, tipicamente 1-3 tasks no total**. DAG-parallelism raramente se aplica; não invente phases. Se o blast radius (Agent 3) forçar fan-out em múltiplos consumidores, esses viram phases paralelos sob o phase de impl, com `<depends-on>` no impl.
- `<problem-statement>` DEVE citar o ponto de repro (`file:line`). `<solution-approach>` DEVE citar o ponto de causa raiz (`file:line`) e qual lado da bifurcação sintoma/causa foi escolhido. `<decisions>` captura a resposta da bifurcação verbatim.
- Quando `hasTests=false`, o phase do teste é omitido; o phase de impl carrega um `**Exemplars**` apontando para o ponto de repro para que o builder reproduza o trigger em verificação manual.

Validação mecânica (`validate-plan.ts`) e implicit-touch sweep rodam idênticos. O plano ativo não é comitado (transient artifact — builders leem do disco; durable record é o archive em Stage 5).

## Stage 3 override — Augmentation do builder do teste-primeiro

Quando o phase a ser dispatchado é o phase de teste-primeiro de um plano bug-mode (primeiro phase do plano, `hasTests=true`), apenda esta instrução ao prompt do builder após a montagem padrão de `assemble-task-prompt.ts`:

> Esta é uma task de teste-primeiro em um bug fix. Escreva o teste, então rode localmente (`bun test <file>` ou equivalente do projeto). O teste DEVE falhar com o sintoma documentado em `<problem-statement>` — essa é a prova de que ele exercita o defeito. Se seu primeiro attempt passar, o teste não dispara o bug; reescreva citando o ponto de repro `<file:line>` dos findings do Explore. Commite apenas quando o teste falhar pelo motivo correto (não por erro de import, syntax, ou setup). O phase seguinte vai implementar o fix e seu teste vai passar.

Para os demais phases (impl, consumer-fixes), o prompt do builder é montado normalmente. Os findings do Explore passados a cada builder incluem o `file:line` de repro e de causa raiz verbatim — builders DEVEM citar esses pontos em vez de reinvestigar.

Todo o resto do Stage 3 (DAG scheduler, retries, marcação de `status="done"`, inline Explore on resume) é idêntico.

## Stage 4 override — Gates

Rode `check-project` e o residual scan como sempre.

**Pule `spec-coverage`** se o plano não tem blocos `<spec>` (planos de bug fix raramente têm). Quando o plano tem `<spec>` (bug que motivou redesenhar um contrato), rode normalmente.

Sem gate extra de revert-confirm — a garantia de que o teste exercita o bug já vem da disciplina do Stage 3 (builder confirmou falha antes de commitar) e da ordem dos phases (o phase de impl só roda depois que o teste vermelho está commitado, então a transição vermelho→verde é observável no `check-project` final).

## Stage 4.5 override — Inversão do default do test triage

Em `/devorch`, a decisão "update-test vs fix-impl" é caso-a-caso. Em bug-mode, **default é fix-impl**. Update-test exige cobertura explícita do `<decisions>` (o plano declarou mudança de contrato como parte do fix) OU o teste assertava o comportamento bugado antigo (caso raro: o teste estava errado o tempo todo e o fix corrige justamente o que ele assertava).

Racional: feature work muda contratos intencionalmente, então testes antigos legitimamente precisam atualizar. Bug fixes preservam o contrato intencional — um teste falhando depois de um bug fix é quase sempre regressão real ou defeito adjacente exposto pelo fix.

Logue a decisão no triage line:

```
Test triage: <test-name>
  Decision: fix-impl (bug-mode default) | update-test (justificado por <decision-id>) | pre-existing-pendency
  Reason: <uma linha>
```

Todo o roteamento restante do Stage 4.5 (lint, build, residual scan, dispatch shape de trivial-batch + fix-level paralelos, retry budget) é igual.

## Stage 5 — Ajustes no verdict report

Adicione duas seções ao verdict report (entre `### Test triage` e `### Residual scan`):

```
### Sintoma vs causa
<A (sintoma) com motivo | B (causa) com motivo | N/A — repro e causa no mesmo ponto>

### Teste de regressão
<arquivo:teste-nome — confirmado vermelho pré-fix, verde pós-fix | N/A — hasTests=false>
```

**Gotcha capture é promovido**: a quality bar do gotcha é a mesma (4 critérios), mas a enumeração de candidates DEVE sempre rodar após um PASS de bug fix. O ponto de repro + causa raiz + parágrafo do porquê-a-invariante-falhou (Stage 1) é a fonte de mais alta qualidade que o framework consegue. Pular gotcha capture aqui é deixar o artefato mais durável do run no chão. Se mesmo assim nenhum candidate passa a quality bar, omita a seção do report como `/devorch` orienta.

Archive plan, merge logic, conflict resolution rule, flow friction capture: idênticos a `/devorch`.

## Rules

Todas as Rules de `/devorch` aplicam (post-bifurcation autonomy, Explore claim re-verification, no narration, language policy, output format). Mais:

- **Resume em bug-mode**: `/devorch-bug --resume` aplica os overrides de bug-mode aos estágios restantes independentemente de como o worktree foi originalmente criado. Se o usuário quer defaults de `/devorch` numa sessão retomada, ele invoca `/devorch --resume`.
- **Disciplina do sintoma-fix**: quando o guardian escolheu opção A (sintoma), o `### Issues pendentes` do verdict report DEVE flaggar a causa raiz não resolvida como `Symptom fix only — causa raiz em <file:line> intacta. Sessão dedicada recomendada.` Mantém o trabalho diferido visível em `git log` e no report.
