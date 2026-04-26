# Self-build of devorch uses global ~/.claude/devorch-scripts/ paths

**Timestamp**: 2026-04-26
**Mode**: full
**Severity**: nit

## Prompt pronto

```
/devorch --full "When devorch is building devorch (self-build), commands/devorch.md Steps 9d, 13, 9e and adversarial-review reviewer prompts all reference scripts at ~/.claude/devorch-scripts/<script>.ts (global install paths). For external projects this is correct; for the self-build case the orchestrator should run the worktree's local scripts/<script>.ts so that the edits being built are also the ones being tested. Detect self-build via package.json name === 'devorch' and rewrite the script paths during phase execution and self-tests."
```

## Contexto

Durante este plan (`flow-friction-residual-fixes`):
- Phase 1 Wave 3 builder report explicitamente: "Run `bun /home/bruno/.claude/devorch-scripts/validate-plan.ts ...` pointed at the user's global devorch-scripts copy rather than the worktree's edited file — I caught it and ran against the local path instead."
- Step 11 (review fixes) — eu (orquestrador) cometi o mesmo erro ao rodar `bun /home/bruno/.claude/devorch-scripts/init-phase.ts ...` para self-test depois das edits, e vi a saída no formato antigo (porque o global ainda tinha a versão pre-Wave 1). Demorei uma rodada para perceber que precisava do path local.

## Esperado

Em commands/devorch.md, Steps 9d, 9a (init-phase invocation), 9e (phase-summary), e 13 (merge-worktree) — quando `package.json.name === "devorch"` no projectRoot, usar `<projectRoot>/scripts/<script>.ts` em vez de `~/.claude/devorch-scripts/<script>.ts`. Reviewer prompts e builder-prompt acceptance checks idem.

Alternativa: skill macro que substitui `$CLAUDE_HOME/devorch-scripts/` por `<projectRoot>/scripts/` automaticamente quando self-build é detectado.

## Workaround aplicado

Manualmente reescrevi o path do init-phase para o worktree local quando vi o output antigo. Funcionou. Mas a falha é silenciosa — o orquestrador pode não notar que está testando contra a versão pre-merge.

## Impacto

Self-builds são raros (devorch v3 é estável), mas quando acontecem, o orquestrador testa contra a versão antiga e pode declarar PASS prematuramente. Para o usuário comum (devorch em projetos externos) o atrito não existe.
