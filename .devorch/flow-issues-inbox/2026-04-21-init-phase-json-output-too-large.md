# init-phase.ts: JSON output 51KB força parsing out-of-band pelo orchestrator

- **Timestamp**: 2026-04-21
- **Mode**: full
- **Severity**: nit

## Prompt pronto
```
/devorch --full "Em init-phase.ts, quebrar o output em duas saídas: (a) summary JSON compacto no stdout com shape {phaseNumber, phaseName, totalPhases, waves, taskIds: string[], sliceWarnings, satellites}; (b) detail files opcionais em disco (`<mainRoot>/.devorch/phase-init-<N>/tasks/<id>.md`) para gotchas, exemplars, spec contracts e non-goals por task. Orchestrator lê summary inline, builders recebem path para detail file em vez de o orch injetar tudo manualmente."
```

## Contexto
- **Onde**: F3a init-phase em plan com 3 tasks.
- **O que aconteceu**: `init-phase.ts --plan ... --phase 1` retornou 51.9KB de JSON (gotchas + code structure + spec contracts + exemplars + tasks content, tudo inline). A CLI truncou o stdout e persistiu em um arquivo auxiliar; tive que rodar um `bun -e` com `JSON.parse(readFileSync(...))` para extrair só os campos que interessam (waves, taskIds, sliceWarnings).
- **Esperado**: o orchestrator quer um summary pequeno e injeta detalhe nos builder prompts conforme necessário. O JSON atual empacota TUDO e força parsing out-of-band mesmo quando o orch só precisa dos taskIds + sliceWarnings.
- **Impacto**: funcional, mas cria atrito: (1) não consigo pipeá-lo direto via Bash; (2) gastar tokens interpretando campos que posso não usar; (3) aumenta risco de o orch truncar o output.
