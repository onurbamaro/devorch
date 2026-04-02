# Explore Cache
Generated: 2026-04-02T10:00:00Z

## Talk-to-Build Information Flow

### Current Plan Format Spec Elements
- `<objective>` — measurable goal (plan-wide)
- `<decisions>` — user choices as Question → Answer pairs
- `<solution-approach>` — approach + alternatives (medium/complex only)
- `<criteria>` — checklist of acceptance criteria per phase
- `<test-contract>` — optional test expectations per phase
- `<handoff>` — what next phase needs

### What Builders Actually Receive (via init-phase.ts)
Builders get: objective, decisions, solution-approach as **explicit structured fields**, plus full phase content (includes criteria, test-contract, handoff) as **embedded markdown** in the `content` field.

### Critical Gaps Identified
1. **No behavioral specs (input → output)**: No structured "When X is called with Y, output Z" contracts
2. **No error handling contracts**: Error behavior captured in `<decisions>` as narrative, not machine-readable
3. **No interface/type contracts**: Function signatures and API shapes inferred from code, not specified
4. **Criteria not enforced**: Embedded in markdown, no verification mechanism for builders
5. **`<test-contract>` essentially unused**: Zero usage across 5 archived plans, validate-plan.ts only warns if empty
6. **Decisions disconnected from tasks**: Tasks don't cross-reference which decisions apply to them

### Builder Agent Gap
- `agents/devorch-builder.md` tells builders they "have a clear spec" but:
  - No instruction to read/verify `<criteria>` before starting
  - No instruction to verify implementation against `<test-contract>`
  - Spec elements embedded in markdown, not highlighted as acceptance gates

## Plan Quality Analysis (Archived Plans)

### Task Description Quality
- **Strengths**: Detailed (5-15 lines), explicit CLI invocations, cross-phase handoff documented
- **Weaknesses**: Behavioral specs lack measurable triggers/outcomes, error paths implicit not explicit, optional field behavior vague

### Criteria Sections: Structural, Not Behavioral
- Focus on artifact existence ("file X exists, accepts flags Y") and format validation
- Missing: behavioral correctness ("when X happens, system does Y"), integration contracts, error recovery specs
- No criteria specify input/output relationships or error scenarios

### test-contract: Defined but Never Used
- validate-plan.ts:141-145 checks existence but only warns if empty
- Zero usage across all 5 archived plans
- No downstream consumption: build.md doesn't extract it, builders aren't required to validate against it

### Validation Script (validate-plan.ts)
- Validates structure only: required tags, classification fields, sequential numbering, wave conflicts
- Does NOT validate: criteria measurability, task behavioral completeness, error path documentation, cross-phase handoff compatibility

## Spec-Driven Development Research

### Core Concepts
- **Spec-Driven Development (SDD)**: Specification as authoritative source of truth; code implements the spec
- **Design by Contract (DbC)**: Preconditions (require), postconditions (ensure), invariants — contracts between components
- **BDD**: Executable specifications bridging business requirements and technical implementation
- **Property-Based Testing**: Invariants that hold for all valid inputs, not just example cases

### AI Code Generation + Specs (Research Findings)
- Combined spec-test-implement systems outperform LLM-only generation
- SpecGen: 100/120 programs verified vs 72 for conversational and 42 for non-LLM methods
- Formal verification identifies issues in LLM-generated code; automated repair fixes them
- LLMs with spec responsibility engage in self-consistent planning improving accuracy

### Applicable Spec Patterns for devorch
1. **Design by Contract**: preconditions/postconditions/invariants per function/module
2. **API Contracts**: request/response schemas, status codes, error responses (OpenAPI-style)
3. **Properties/Invariants**: Mathematical or logical constraints that must always hold
4. **State Machine Specs**: States, allowed transitions, pre/postconditions per transition
5. **Error Classification**: Retryable vs non-retryable, backoff strategies, circuit breakers
6. **Data Invariants**: Constraints on data integrity across operations

### Alignment with devorch Philosophy
- Principle 3 (Compute outside LLM): Spec validation happens in scripts, not by LLM
- Principle 4 (Structure enables parallelism): Specs make task boundaries explicit
- Principle 5 (Clarify before you build): Specs ARE executable clarification
- Principle 6 (Code is source of truth): Specs document intent; code implements; validation proves alignment
