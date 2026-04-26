# `init-phase.ts` não produz `codeStructureByTask` para tarefas com `Repo: <satellite>`

- **Timestamp**: 2026-04-22T(session)
- **Mode**: full (`--resume`, phase 8)
- **Severity**: gap

## Prompt

```
/devorch --full "estender init-phase.ts pra também mapear code structure do(s) satellite repo(s) quando a fase tem tasks com Repo: <satellite> — hoje só mapeia o primário"
```

## Contexto

Fase 8 do plano `track-match-v2-cross-repo.md` tem 4 tasks, todas com `Repo: dochron`. O output de `init-phase.ts --phase 8` veio com:

```json
"codeStructureByTask": {},
```

(objeto vazio). Tasks primárias em phases 6 e 7 vieram com structure detalhada (exports, imports, functions, types).

## Impacto

Builders satélite entraram cegos — tiveram que explorar `src/client/routes/admin.tsx`, grep por `NotificationBell`, localizar `useToast`, etc., sem cache de structure. Sobrecarregou o prompt com "explore guidance" manual e aumentou latência de cada task em ~1–2 min de grep/read.

## Esperado

Quando `init-phase` detecta `satellites[]` no plan e uma ou mais tasks têm `repo: "<satellite-name>"`, rodar a coleta de code structure também no satellite worktree path pra cada task satélite. Pode usar a mesma lógica que já cobre o primário.

## Workaround aplicado

Prompt manual: pedi aos builders que grepassem exemplar paths conhecidos (track-edit.$trackId.tsx linha 73, admin.tsx shell, etc.). Funcionou mas foi artesanal.
