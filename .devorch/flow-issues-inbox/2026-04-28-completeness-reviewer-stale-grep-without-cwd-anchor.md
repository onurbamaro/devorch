# Completeness reviewer reports "backend missing" via stale grep against wrong worktree

**Timestamp**: 2026-04-28
**Severity**: gap

## Prompt
/devorch "in Step 10 reviewer prompts, replace the freeform 'Working directories' header with EXPLICIT pre-verified evidence: include grep-confirmed file:line citations (3-5 per task block) showing the canonical 'these symbols ARE present in the changed code' so the reviewer cannot falsely claim absence without contradicting the prompt itself. The current anti-staleness directive ('Before reporting a contract as unsatisfied, grep for the expected new symbol or phrase') relies on the reviewer voluntarily double-checking — and at least one in this session didn't, reporting the entire backend as 'unsatisfied' across 7 spec elements. Re-running with absolute-path grep evidence inline made the reviewer pivot to 'limpo'. The first run was effectively wasted Explore time. Bake the evidence into the prompt up front."

## Context

- **Where**: Step 10 adversarial review, completeness reviewer.
- **What happened**: First run of `subagent_type="Explore"` for the completeness review reported `✗ Unsatisfied` on 7 backend spec elements (zod schema previewSignals, divergence log, three silent-catches, feature flag, fallback) with grep evidence `Output: (empty)`. The grep was run from a shell whose cwd defaulted to `/home/bruno/dev/dochron/` (NOT the satellite worktree subfolder). The base-branch repo doesn't have the changes; only the `devorch/classifier-divergence-observability` branch does. Anti-staleness directive WAS in the prompt verbatim but didn't prevent the bad grep — the agent grepped, got empty, and concluded "missing" instead of "let me re-grep with the absolute worktree path". 
- **Expected**: Reviewer prompt includes pre-verified file:line evidence (5–10 lines) like `src/server/lib/env.ts:206` `LAYOUT_CLASSIFICATION_V2_ENABLED` getter present, `src/server/lib/queues/upload-workers.ts:215` 'classifier divergence detected' string present. Reviewer can THEN verify or contradict, but cannot trivially "discover" a gap that's not actually there.
- **Workaround**: Orchestrator detected the obviously-stale report (manually grepped to confirm), re-ran the reviewer with absolute-path evidence baked in, second run came back limpo. Wasted ~5 minutes of Explore time.
- **Adjacent**: The anti-staleness directive should also tell the reviewer to ALWAYS prefix paths with the absolute worktree root in greps — bare `src/...` resolves to wherever the shell defaults, which is unreliable across an Explore session that runs many bash commands.
