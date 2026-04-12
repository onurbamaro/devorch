# Explore Cache
Generated: 2026-04-12T00:00:00Z

## Build Mechanism and Context Flow

### Context Pipeline: Plan → init-phase → Builder

Pipeline is strictly linear: plan file (markdown/XML) → `init-phase.ts` JSON → orchestrator assembles per-task prompt → builder Task call.

**init-phase.ts assembles:**
1. Plan-level fields: objective, decisions, solutionApproach
2. Phase content (raw XML block)
3. Handoff from phase N-1 (only cross-phase data threaded forward)
4. Conventions (full + per-task filtered by file extension via EXT_KEYWORDS)
5. State.md (last completed phase + summary)
6. Explore cache (filtered per-task by file path references in task body)
7. Spec contracts (filtered per-task via **Spec refs** field)
8. TLDR code structure (ts-morph analysis of referenced .ts/.tsx files, filtered per-task)
9. Project map (from map-project.ts, cached 5min)
10. Waves and tasks parsed from execution/tasks blocks
11. Cache coverage boolean (cacheCoversPhase) + uncoveredFiles array

Content file threshold: >50,000 chars → written to .phase-context.md file.

**What orchestrator sends per-builder:**
- Plan objective, solutionApproach, decisions (shared across all tasks)
- Task's own full content
- Filtered conventions (sections matching task file extensions, or full if filtering yields nothing)
- Filtered code structure (TLDR of files referenced in task)
- Filtered spec contracts (specs listed in task's **Spec refs**)
- Filtered cache sections (cache sections mentioning task's file refs)
- Effort guidance + commit format + TaskUpdate reminder

**What builders do NOT see:**
- Other tasks' contents/specs
- Full explore cache (only filtered sections)
- Full conventions (only filtered sections usually)
- Project map (in orchestrator context only)
- Previous phase content (only handoff summary)
- Other builders' outputs from same wave

### Isolation Model

- Phases: completely isolated at builder level. Only cross-phase data is handoff tag + state.md metadata
- Tasks within phase: each builder gets only its own filtered context
- Explore cache: shared per-plan (not per-phase), filtered by file path substring. Cross-phase leak vector by design (accumulated knowledge)
- Git worktree: shared across all phases — no branch-per-phase isolation
- Filesystem: no actual sandbox, only behavioral scoping in agent prompts

### Handoff Mechanism

- Static `<handoff>` XML tag written at planning time (pre-execution)
- state.md: runtime counterpart, written by phase-summary.ts after each phase
- manage-cache.ts: implicit handoff — invalidates cache for files touched in last commit, trims to 3000 lines

### Builder Scoping

Builders can launch Explore sub-agents as escape hatch for uncovered code. Both devorch-builder and devorch-builder-deep are structurally identical prompts — only frontmatter effort field differs.

Lint hook (post-edit-lint.ts) creates fast feedback loop within builder context — runs biome/eslint immediately after each Write/Edit.

## Plan Quality Patterns

### What makes plans good:
- Precise problem-statement naming specific failure modes (not generic descriptions)
- Solution-approach recording rejected alternatives with reasoning
- Spec contracts grounded in real discovered artifacts (real function names, line numbers, file paths)
- Error-contracts with 2-3+ distinct triggers (not just happy path)
- Invariants encoding cross-cutting constraints not derivable from single specs
- Wave design with conscious parallelism reasoning (producer/consumer logic)
- Tasks with line-level specificity (self-contained, executable without prior context)
- Spec-refs on every task

### Failure patterns:
- Over-scoped tasks: 4-5 conceptual changes in one task, no spec elements, correctness burden on prose
- Under-scoped tasks: missing Model/Effort/Spec refs, builder gets no structured contract
- Missing decisions: builders make architectural decisions conflicting with unrecorded user intent
- Vague specs: "the timeout should work correctly" vs "QUICK_TIMEOUT_MS is 30_000 and inner SIGKILL timer has clearTimeout handle"
- Missing error-contracts: builders implement happy path only
- Tasks without spec-refs: building to prose descriptions only

### Builder failure modes:
- Spec gaps → wrong implementation (happy path only)
- Convention gaps → inconsistent patterns
- Cache gaps → unnecessary exploration consuming context
- Over-reliance on LLM for deterministic checks
- Premature completude declarations

## Industry Research: AI Coding Harnesses

### Context Rot (Chroma 2025)
- ALL 18 frontier models tested degrade with longer context
- Performance follows U-curve: strong at start/end, weak in middle
- Accuracy drops 30%+ when relevant info is at intermediate positions
- Similar distractors amplify degradation dramatically
- Agent-generated context quickly becomes noise

### Key Patterns from Industry:

**Observation Masking (JetBrains Research):** Replace old observations with placeholders, preserve reasoning/action history. +2.6% solve rate while reducing costs 52%. Outperforms LLM summarization.

**Sub-Agent Isolation ("Context Firewall"):** Sub-agents run in separate context windows, receive only task-relevant info + project context. Condensed result returns to parent. Claude Code uses this for code review.

**Cross-Agent Knowledge Propagation (SWE-AF):** Shared memory stores: codebase_conventions, failure_patterns, bug_patterns, interfaces/{issue_name}, build_health. Injected per-iteration without full history.

**Risk-Proportional Resource Allocation (SWE-AF):** Easy issues: 2 LLM calls. Flagged issues: 4 LLM calls. Based on scope, interface touches, unfamiliarity.

**Graceful Degradation with Typed Debt (SWE-AF):** Gaps become typed debt items with severity. Propagated downstream. Not binary success/fail but spectrum of completeness.

### Known limitations:
- 41-86.7% of multi-agent LLM systems fail in production
- Performance drops ~39% in multi-turn conversations
- Models form assumptions on incomplete info in early turns, keep building on them
- Context windows of 1-2M tokens cover only thousands of files
- Larger windows don't eliminate need for curation — they facilitate unnoticed quality degradation
- 67.3% AI-generated PRs rejected vs 15.6% manual (Google DORA 2025)
