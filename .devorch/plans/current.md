# Plan: devorch UX improvements

<description>
Improve devorch tooling based on real usage feedback: better validator error messages, named plan files, DA explore-cache constraints, clarification round optimization, and classification type documentation.
</description>

<objective>
All user-reported issues are addressed: validator shows valid values in errors, plans use named files instead of current.md, DA respects explore-cache, clarification uses recommendations when confidence is high, classification values are documented, and infrastructure type is valid.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: low
</classification>

<decisions>
- Named plans approach -> Use `<name>.md` instead of `current.md` for plan files
- Issue 4 (wave conflicts) -> Already implemented, removed from scope
- Type values to add -> infrastructure only (migration already exists)
- DA constraint -> Add explicit explore-cache non-contradiction rule
- Clarification -> Add recommendation-with-opt-out guidance for high-confidence approaches
- Documentation -> Document all classification values and endpoint spec ref format
- Backward compat -> Fallback to current.md when named plan not found
- Error messages -> Show valid values and available specs in validator errors
- Fix.md -> Has zero references to current.md, excluded from scope
- Post-compact hook and list-worktrees -> Added to scope per DA findings
</decisions>

<problem-statement>
8 issues identified during real devorch usage: stale current.md in worktrees, unhelpful validator error messages, undocumented classification values, DA generating false positives by contradicting explore-cache, excessive clarification rounds, missing infrastructure type, and hardcoded current.md in hooks/scripts.
</problem-statement>

<solution-approach>
Replace the current.md convention with named plan files (<name>.md) to eliminate stale plans in worktrees. Improve validate-plan.ts error messages to include valid values and available specs. Add DA constraint about explore-cache to talk.md. Add recommendation-with-opt-out guidance to step 3. Document classification values and endpoint spec ref format in Plan Format Rules. Update all files that hardcode current.md (build.md, list-worktrees.ts, post-compact-state-refresh.ts, README.md, docs). Add infrastructure to valid types.
</solution-approach>

<relevant-files>
- `scripts/validate-plan.ts` — type regex and error message generation
- `commands/talk.md` — plan workflow, DA step, clarify step, plan format rules
- `commands/build.md` — plan path resolution, archive-plan calls
- `scripts/list-worktrees.ts` — hardcoded current.md read at line 158
- `hooks/post-compact-state-refresh.ts` — hardcoded current.md read at line 75
- `scripts/lib/plan-parser.ts` — parseSpecNames function (reference only)
- `README.md` — state_files documentation at line 243
- `docs/build-phase-reference.md` — legacy docs with current.md references

<new-files>
</new-files>
</relevant-files>

<phase1 name="UX Improvements">
<goal>Implement all remaining improvements across validator, command files, scripts, and docs.</goal>

<spec>
<interface name="verbose-type-error">
  <input>Classification block with invalid Type value</input>
  <output>Error message including all valid types and the received value. Format: "Classification: invalid Type '{received}'. Must be one of: feature, fix, refactor, migration, chore, enhancement, infrastructure"</output>
  <error case="missing-type">"Classification: missing Type. Must be one of: feature, fix, refactor, migration, chore, enhancement, infrastructure"</error>
</interface>

<interface name="verbose-spec-error">
  <input>Task spec ref that does not match any spec name in the phase</input>
  <output>Error: "Phase {N}: task '{tid}' references unknown spec '{ref}'. Available specs in this phase: [{spec-a}, {spec-b}, {GET-/api/health}]"</output>
</interface>

<behavior name="named-plan-files">
  <precondition>talk.md step 7/7i writes plan to worktree</precondition>
  <postcondition>Plan filename is name.md (from step 1b) instead of current.md. All command file references updated. Legacy migration check in step 1 KEEPS checking for current.md. Scripts that read plan files use glob or readdir on plans/ dir (excluding archive/) with fallback to current.md.</postcondition>
</behavior>

<behavior name="da-explore-cache-constraint">
  <precondition>DA agent receives explore-cache content as context</precondition>
  <postcondition>DA mandate includes: "Findings confirmed by explore-cache with file evidence are established facts. Do NOT contradict them without NEW code evidence not present in the cache. Before reporting a finding, verify it is not already confirmed or refuted by the explore-cache. Focus on risks NOT covered by the exploration."</postcondition>
</behavior>

<behavior name="clarify-recommendation-mode">
  <precondition>Step 3 guidance for clarification rounds</precondition>
  <postcondition>Added guidance: "When exploration provides clear evidence for an approach, present as RECOMMENDATION with opt-out instead of open question. Reserve open questions for genuinely ambiguous decisions where exploration provides no clear basis to recommend."</postcondition>
</behavior>

<behavior name="classification-docs-in-format">
  <precondition>Plan Format Rules section in talk.md</precondition>
  <postcondition>Documented: Classification values with Type including infrastructure. Endpoint spec refs use METHOD-/path format.</postcondition>
</behavior>
</spec>

<tasks>
#### 1. Validator error messages and infrastructure type
- **ID**: validator-improvements
- **Assigned To**: builder-1
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: verbose-type-error, verbose-spec-error
- Add `infrastructure` to the Type validation regex at line 44 of `scripts/validate-plan.ts`
- Change the Type error message (line 45) to include all valid types and the received value. Handle both missing and invalid cases separately.
- Change the Complexity error message (line 48) to include valid values: simple, medium, complex
- Change the Risk error message (line 51) to include valid values: low, medium, high
- Change the spec ref error message (around line 242) to include the list of available spec names in the phase (from the specNamesSet). Format: "Available specs in this phase: [name1, name2, ...]"
- Do NOT change any validation logic beyond adding infrastructure to the regex — only improve error messages

#### 2. Talk command improvements
- **ID**: talk-improvements
- **Assigned To**: builder-2
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: named-plan-files, da-explore-cache-constraint, clarify-recommendation-mode, classification-docs-in-format
- **Named plans**: In steps 7 (worktree path) and 7i (inline path), replace `current.md` with `<name>.md` in the plan file path. Update steps 10, 10i (commit and archive-plan calls), 11 (suggest next). CRITICAL: KEEP the legacy migration check in step 1 pointing at `current.md` — that is its purpose for backward compat.
- **DA constraint**: In step 6b, add to the DA agent mandate: "The DA must NOT contradict findings from the explore-cache without NEW code evidence not present in the cache. Findings confirmed by explore-cache with file evidence are established facts — accept them and focus on risks NOT already covered by the exploration. Before reporting a finding, verify it is not already confirmed or refuted by the explore-cache."
- **Clarify guidance**: In step 3, add after the "Ask in rounds" paragraph: "When the exploration provides clear evidence for an approach, present it as a RECOMMENDATION with opt-out (e.g., 'Recomendo X por causa de Y. Concordas?') instead of an open question. Reserve open questions for genuinely ambiguous decisions where exploration provides no clear basis to recommend."
- **Classification docs**: In the Plan Format Rules section (near end of file), add a line: "- Classification values — Type: feature | fix | refactor | migration | chore | enhancement | infrastructure. Complexity: simple | medium | complex. Risk: low | medium | high."
- **Endpoint ref docs**: In the Plan Format Rules section, add: "- Endpoint spec refs use the auto-generated `METHOD-/path` format (e.g., `GET-/api/health`) matching the `<endpoint path method>` tag attributes."

#### 3. Build command and scripts — named plans
- **ID**: build-scripts-named-plans
- **Assigned To**: builder-3
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: named-plan-files
- **build.md**: Replace references to `current.md` with `<name>.md` where `<name>` is the plan/worktree name. Add backward compatibility note: "If `<name>.md` is not found, fall back to `current.md` for worktrees created before named plans were introduced." DO NOT touch fix.md (it has zero references).
- **list-worktrees.ts** (line 158): Change from reading hardcoded `current.md` to finding the plan file dynamically. Use `readdirSync` on `.devorch/plans/` to find `.md` files (excluding the `archive/` subdirectory). Take the first non-archive `.md` file. If no match found, report "(no plan)" as before. Follow existing code conventions (no third-party deps, Bun APIs).
- **post-compact-state-refresh.ts** (line 75): Same approach — find plan file dynamically instead of hardcoded `current.md`. Use `readdirSync` on `.devorch/plans/` to find `.md` files (excluding archive/). Take the first match. If no match, use fallback values (unknown plan, ? phases). Keep the try-catch error suppression pattern already in the file.

#### 4. Documentation updates
- **ID**: docs-updates
- **Assigned To**: builder-4
- **Model**: sonnet
- **Effort**: low
- Update `README.md` line 243: change `path: .devorch/plans/current.md` to `path: .devorch/plans/<name>.md` (where `<name>` is the plan name)
- Update `docs/build-phase-reference.md`: replace the three occurrences of `.devorch/plans/current.md` with `.devorch/plans/<name>.md`. Add a note that `<name>` is the plan name derived from the worktree/branch name. This file is legacy/archived documentation but should reflect the current convention.
</tasks>

<execution>
**Wave 1** (parallel): validator-improvements, talk-improvements, build-scripts-named-plans, docs-updates
</execution>

<criteria>
- [ ] validate-plan.ts accepts `infrastructure` as valid Type
- [ ] Type/Complexity/Risk error messages include valid values
- [ ] Spec ref errors include available spec names in the phase
- [ ] talk.md references `<name>.md` instead of `current.md` (except legacy migration check)
- [ ] talk.md step 6b includes DA explore-cache constraint
- [ ] talk.md step 3 includes recommendation-with-opt-out guidance
- [ ] talk.md Plan Format Rules documents classification values and endpoint ref format
- [ ] build.md references `<name>.md` with `current.md` fallback
- [ ] list-worktrees.ts dynamically finds plan files instead of hardcoded current.md
- [ ] post-compact-state-refresh.ts dynamically finds plan files instead of hardcoded current.md
- [ ] README.md and docs/build-phase-reference.md updated
</criteria>
</phase1>
