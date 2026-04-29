# Plan spec format strictness blocks first validation pass

**Timestamp**: 2026-04-28
**Severity**: gap

## Prompt to fix

```
/devorch "in docs/PLAN-FORMAT.md, add a copy-pasteable minimal example showing the exact required nesting: <endpoint method='X' path='/y'><request>...</request><response status='200'>...</response></endpoint>, <interface name='X'><input>...</input><output>...</output></interface>, <error-contract name='X'><case status='400' condition='...'>...</case></error-contract>, <behavior name='X'><precondition>...</precondition><postcondition>...</postcondition></behavior>. Also clarify that Spec refs in tasks must use bare names (no backticks, no type prefixes like 'endpoint /api/foo' — just '/api/foo' or the named symbol). The orchestrator instructions in agents/devorch.md don't surface these rules and the validator's error messages are detailed but reactive."
```

## Context

- **Where**: Step 7 (write plan) → Step 8 (validate-plan.ts).
- **What happened**: First plan write produced an `<endpoint>` with prose body (no `<response>` child), `<interface>` with TypeScript code (no `<input>`/`<output>` children), `<error-contract>` with prose (no `<case>` children), `<behavior>` with prose (no `<precondition>`/`<postcondition>`). Validator returned 7 structural errors plus 16 "spec ref not defined" errors because spec refs used backticks (`` `endpoint /api/foo` ``) and type prefixes — parser strips and indexes by bare name.
- **Expected**: First plan write passes validation, OR the orchestrator-level instructions include enough format detail that the LLM produces a compliant first draft.
- **Workaround**: Rewrote the entire `<spec>` block to add child tags, then stripped backticks/prefixes from all spec refs across 3 tasks. ~5 min lost.
- **Why it matters for autonomy**: in a fully-autonomous run this would still self-resolve via the validator's rejection messages, but each rewrite is a costly LLM round trip. A canonical example in docs would prevent the first failure entirely.
