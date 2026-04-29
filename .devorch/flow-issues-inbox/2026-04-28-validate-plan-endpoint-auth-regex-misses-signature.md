# Validate-plan endpoint auth-annotation regex misses signature-based auth

**Timestamp**: 2026-04-28
**Severity**: nit
**Prompt**: `/devorch "Extend validate-plan.ts endpoint auth-annotation regex to recognize signature-based auth (HMAC, MD5, signature, signed) as valid auth markers for webhook endpoints — not just /jwt|auth|token|public|internal|network|api-key/."`

## Where
`/home/bruno/.claude/devorch-scripts/validate-plan.ts` ~line 256: `const authKeywords = /jwt|auth|token|public|internal|network|api-key/i;`

## What happened
The plan declared two `<endpoint method="POST">` items for webhook receivers (POST /webhook/99food, POST /webhook/ifood) whose auth model is signature-based (MD5 / HMAC-SHA256 with shared secret). The `<request>` block described the signature header (`didi-header-sign`, `x-ifood-signature`) but did not contain `auth|token|jwt|api-key|public|internal|network`. Validator emitted: "mutating endpoint POST /webhook/99food <request> has no auth annotation — consider specifying auth requirements."

I had to inject the literal word "auth" (e.g. "Auth: signature-based — public ingress, no JWT/api-key/token") into the `<request>` description just to satisfy the regex. That is a workaround, not a real annotation improvement.

## Expected
Webhook endpoints with signature-based authentication should pass without keyword-stuffing. Words like `signature`, `signed`, `hmac`, `md5`, `webhook signature` should count as valid auth annotations.

## Suggested fix
Extend the regex: `const authKeywords = /jwt|auth|token|public|internal|network|api-key|signature|signed|hmac|md5/i;`

One-line change, zero migration cost. Plans that already include the keywords still pass.
