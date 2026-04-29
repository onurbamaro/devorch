# Validate-plan wave-overlap regex too broad

**Timestamp**: 2026-04-28
**Severity**: gap
**Prompt**: `/devorch "Tighten validate-plan.ts wave-overlap detection: when computing per-task touched files, exclude paths that appear ONLY in **Exemplars** or **Non-goals** lines. Currently the regex captures every backticked path from the entire task body, which causes false-positive overlap blocks when two wave-mates list the same exemplar or non-goal."`

## Where
`/home/bruno/.claude/devorch-scripts/validate-plan.ts` ~line 393–410 (wave overlap detection block) + ~line 376 (file mention regex).

## What happened
In durable-webhook-queue plan, Phase 2 Wave 1 had `receiver-99food-async` and `receiver-ifood-async` as parallel tasks targeting `99food.webhook.ts` and `ifood.webhook.ts` respectively. The receiver-99food-async task had an `Exemplars` line: "the handler iFood atual é o template..." which referenced `src/modules/ifood/ifood.webhook.ts`. The validator returned `result: block` with: "tasks ... overlap on src/modules/ifood/ifood.webhook.ts" because both tasks had a backticked path to that file in their body — even though one is an exemplar (read-only reference) and the other is the actual modification target.

Same situation surfaced in Wave 2: `worker-99food` and `worker-ifood` both had `src/modules/orders/order.queue.ts` as a shared exemplar — flagged as overlap.

## Expected
Wave-overlap detection should distinguish between "files modified by this task" (should not overlap with wave-mates) and "files referenced for context" (Exemplars, Non-goals, prose mentions — irrelevant to the merge-conflict risk).

## Workaround
Manually edited the plan to remove backticked paths from Exemplars/Non-goals, replacing with prose descriptions. Cost: ~5 minutes of edit churn + a re-validate cycle.

## Suggested fix
Either:
- (a) When parsing each task section, strip the `**Exemplars**:` and `**Non-goals**:` lines from the regex input before extracting backticked paths.
- (b) Introduce an explicit `**Modifies**: path1, path2` per-task field that, when present, takes precedence as the canonical "files this task touches" — falling back to body extraction only when absent.

Option (b) is more durable but requires updating PLAN-FORMAT.md and existing plans. Option (a) is a 3-line change and zero migration cost.
