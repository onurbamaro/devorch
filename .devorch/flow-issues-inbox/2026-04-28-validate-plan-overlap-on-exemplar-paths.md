# validate-plan wave-overlap regex captures backtick paths in Non-goals/Exemplars

**Timestamp**: 2026-04-28
**Severity**: gap

## Prompt
/devorch "fix validate-plan.ts wave-overlap detection to ignore file paths cited in Non-goals/Exemplars text — only paths cited in actual edit-implying contexts (Steps lists, postconditions) should count toward the same-repo overlap check. Today the regex `/\\\`([^\\\`]*(?:\\/[^\\\`]+|\\.\\w{1,5}))\\\`/g` matches any backtick-wrapped path-shape, so two tasks both citing the SAME exemplar file (e.g. `src/hooks/useDivergenceToast.ts` as a 'follow this pattern' reference) trigger a false-positive overlap error and force the author to rewrite Exemplars to avoid backticks. Suggest: (a) parse only the body BEFORE 'Non-goals:'/'Exemplars:' lines, OR (b) require a structural marker like `<edits>...</edits>` per task and only count paths inside it, OR (c) accept exemplar paths as long as they're declared in the plan-level <relevant-files> as 'não editado' annotations."

## Context

- **Where**: Step 8, `validate-plan.ts`. Wave conflict detection block.
- **What happened**: Plano com 2 Wave 2 tasks tocando arquivos disjoint (`src/stores/auth.ts` vs `src/components/profile/AccountSection.tsx`). Validador rejeitou com `tasks "auth-store-refactor" and "account-section-adaptive-alert" target same Repo "primary" and overlap on: src/hooks/useDivergenceToast.ts`. O motivo: ambas as tasks listam `useDivergenceToast.ts` em **Exemplars** (referência de pattern, não edit).
- **Workaround**: removi backticks do mention em uma das tasks. Plan re-validou, mas o fix descaracteriza a Exemplars line — leitor humano precisa adivinhar a referência. Não-determinístico (qual remover?).
- **Adjacent friction**: validador também emitiu warning sobre `app/settings.tsx` mencionado em Non-goals como path "não declarado em relevant-files". Mesmo problema: contexto de "NÃO editar" tratado como edit-implying. Resolvi adicionando o path em relevant-files com nota `(não editado)`, mas isso polui a section.
- **Expected**: paths em Non-goals/Exemplars são metadata, não edit intent. Não deveriam disparar overlap detection.
