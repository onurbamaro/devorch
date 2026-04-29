# Wave 1 explore não detectou env-gating em rotas de teste

**Timestamp:** 2026-04-27T(close-e2e-final-gap)
**Severity:** gap

## Prompt pronto

```
/devorch "harden Wave 1 explore default focus to verify each `/api/v1/*` endpoint cited in the task can actually be exercised in the running test env — explicitly grep for `env.<FLAG>` gates in the route file and surface any that the playwright.config webServer.env doesn't set, instead of only reading static patterns."
```

## Contexto

Durante `close-e2e-final-gap`, Wave 1 explore reportou que `signup-email.spec.ts` e `signup-whatsapp.spec.ts` já tinham regex permissivo `/\/(onboarding|\$)/` para o redirect — leitura correta, mas insuficiente. O motivo real do red era que `POST /api/v1/auth/signup/whatsapp` retornava 403 silencioso por `!env.OPEN_SIGNUP` em `src/server/routes/auth/signup.ts:331-333`, e `playwright.config.ts webServer.env` não setava `OPEN_SIGNUP=true`.

Resultado: T1 da Wave 1 detourou para descobrir e adicionar `OPEN_SIGNUP` (commit `c3e3b31`), e T4 (que dependia da mesma fix) mis-classificou `login-magic-link.spec.ts:10` como case `request → context.request` quando na verdade era o mesmo gate de OPEN_SIGNUP. Builder T4 não fez commit — corretamente identificou que a hipótese estava errada — mas o ciclo de "investiga, descobre que é outra coisa, reporta" custou ~5 min por task.

**Esperado:** Wave 1 explore agents listariam env-gates relevantes ao escopo (e.g. `grep -rn "env\.[A-Z_]\+" src/server/routes/<area>/`) e cruzariam com `webServer.env` em `playwright.config.ts` para flagar gates que não estão setados.

**Workaround atual:** prompt explícito do orchestrator pedindo verificação cruzada de envs, ou builder paciente que descobre via trace.
