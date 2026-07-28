# `expo install --check --fix` rejected by CLI; spec referenced invalid combo

Timestamp: 2026-05-13

Severity: nit

Prompt pronto:
```
/devorch "update devorch docs / plan examples to use `bunx expo install --check` (preview) and `bunx expo install --fix` (apply) as separate calls; the combined --check --fix invocation is rejected by expo SDK 55 CLI"
```

## Contexto

Onde: any plan spec that references `bunx expo install --check --fix` for expo dep alignment.

O que aconteceu: builder for `expo-version-align` task ran `bunx expo install --check --fix` per the plan spec. CLI exited with `CommandError: Specify at most one of: --check, --fix`. Builder fell back to `--check` first, then `--fix` to apply. No data loss but spec was technically invalid.

Esperado: spec example should be a valid invocation.

Workaround usado: builder split into two CLI calls (preview, then apply).

Solução durável: update `/devorch` plan examples + bug-mode skill docs to use the two-step pattern, OR `bunx expo install --fix` alone (which applies without asking — appropriate when plan declared "alinhar agora").
