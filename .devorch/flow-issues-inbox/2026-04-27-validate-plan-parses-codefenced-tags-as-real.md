# validate-plan parseia tags dentro de fenced code blocks como reais

**Timestamp**: 2026-04-27
**Severity**: nit

## Prompt sugerido
```
/devorch "validate-plan.ts: tornar parser markdown-aware para que tags <secondary-repos>, <relevant-files>, <new-files> dentro de blocos ``` ``` (markdown code fences) ou inline code não sejam interpretados como conteúdo real do plan. Usar regex pra excluir matches dentro de pares de cercas triplas antes de extractTagContent."
```

## Onde
`scripts/validate-plan.ts:extractTagContent` (e funções derivadas como `extractSecondaryRepos`).

## O que aconteceu
Durante a Phase 3 deste plan eu (orchestrator) escrevi um exemplo em fenced code block dentro do task body para ilustrar a estrutura final esperada do PLAN-FORMAT. O exemplo continha tag `<secondary-repos>` literal. O `validate-plan.ts` parseou o exemplo como se fosse um secondary-repos real e emitiu warning sobre path inválido (`/path` not relative). Tive que reformular o task body sem o exemplo literal pra fazer o validator passar.

## Esperado
Tags dentro de fenced code blocks (delimitados por triplas backticks) ou inline code (single backtick) deveriam ser ignorados pelo extractTagContent — só matches em prosa real deveriam contar.

## Workaround usado
Reescrevi o task body com prosa descritiva sem o exemplo literal de tag. Funciona mas perde-se a clareza de "veja a estrutura abaixo".

## Frequência esperada
Baixa — só dispara quando o plan inclui exemplos de plan format dentro do próprio plan (meta-plans tipo este). Mas valor de DX é alto: deixa o autor escrever exemplos sem se preocupar com false-positive do validator.
