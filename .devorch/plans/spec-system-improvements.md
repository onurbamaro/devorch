# Plan: Spec System Improvements from DoChron Retrospective

<description>
Improve devorch's spec system to prevent the rework patterns found in the dochron retrospective: missing domain model specs, no API contract enforcement, absent security checks, and shadow type systems in multi-repo projects. Also fix two bugs in merge-worktree.ts reported via feedback.
</description>

<objective>
After this plan, devorch will: (1) validate `<entity>` spec elements for domain model decisions, (2) block plans that omit specs for feature/migration/enhancement work of medium+ complexity, (3) warn when mutating endpoints lack auth annotations, (4) warn when schema-touching plans have no entity specs, (5) ask mandatory security questions during planning, (6) detect shared-types directories in multi-repo plans and prompt for import policy, (7) mandate DA to check security and shared-type usage, (8) equip builders with security checklists, and (9) fix selfBuild detection and ENOENT retry in merge-worktree.ts.
</objective>

<classification>
Type: enhancement
Complexity: medium
Risk: medium
</classification>

<decisions>
- Approach → Incremental additions to existing files, no new files or dependencies
- Spec enforcement → Missing spec promoted to error only for feature|migration|enhancement + complexity ≥ medium; other types stay warning
- Semantic checks → Warnings (not errors) when relevant-files includes schema/migration but no entity spec, or routes but no endpoint spec
- Auth on endpoints → Warning when mutating endpoint lacks auth annotation; escape via "internal"/"network"/"api-key" keywords
- Shared types → Question in Step 3 when shared/ directory detected in sibling repos; DA also verifies for satellite tasks
- Builder security → Checklist added to self-verify step of both builder agents
- Global invariants → Format + validation only; extraction/delivery to builders as follow-up
- merge-worktree.ts → selfBuild uses pre-merge hash; ENOENT retry is synchronous (not async)
- Entity children → relationship requires target attr, constraint requires non-empty body
</decisions>

<problem-statement>
The devorch spec system supports domain model, API contract, and security specs via `<interface>`, `<endpoint>`, and `<error-contract>` elements, but lacks enforcement. Plans can proceed with zero specs, no auth on endpoints, and no entity model for schema changes. The dochron retrospective (724 commits, 10 days) showed 22% fix ratio and 3 major rework categories that upfront specs would have prevented: entity model mistakes (pilots/users split), API contract drift (3 alignment branches + 16K lines), and IDOR vulnerabilities (3 endpoints). The mobile app (212 commits) showed 50% rework from shadow type systems — types invented locally instead of importing from shared/api/. Additionally, merge-worktree.ts has two reported bugs from feedback.md.
</problem-statement>

<solution-approach>
Add `<entity>` spec element to the plan format for domain model decisions. Tighten validation: promote missing specs from warning to error for substantial plans, add auth warnings for mutating endpoints, add semantic warnings cross-referencing relevant-files with spec coverage. Improve the planning pipeline: mandatory security question in clarification, shared-types detection for multi-repo, DA mandate upgrade. Add defense-in-depth via builder security checklists. Fix merge-worktree.ts bugs. All changes are additive — no breaking changes to existing plans or workflows.

Alternative considered: separate spec files reusable across plans — rejected due to file management overhead and mismatch with the XML-in-markdown model. Global invariants as a separate file — rejected as over-engineering for now.
</solution-approach>

<relevant-files>
- `scripts/validate-plan.ts` — validation pipeline, ~559 lines. Add entity element checks, promote missing spec, auth warning, semantic warnings
- `scripts/lib/plan-parser.ts` — XML parsing for specs. Add entity to parseSpecNames, filterSpecsByRefs, SpecType
- `commands/talk.md` — orchestrator planning protocol. Update Step 3, Step 6b, Plan Format section
- `agents/devorch-builder.md` — standard builder agent. Add security checklist to self-verify
- `agents/devorch-builder-deep.md` — high-effort builder. Add security checklist to self-verify
- `scripts/merge-worktree.ts` — worktree merge logic, ~532 lines. Fix selfBuild detection and ENOENT retry

<new-files>
</new-files>
</relevant-files>

<phase1 name="Spec System and Bug Fixes">
<goal>All 9 improvements implemented across validation, planning, builders, and merge script</goal>

<spec>
<interface name="entity-element-format">
  <input>XML element `<entity name="...">` containing child elements: `<field name="..." type="..." />`, `<relationship target="..." type="..." />`, `<constraint>text</constraint>`</input>
  <output>Validated entity: name attribute required; at least 1 child (field|relationship|constraint); field requires name attribute; relationship requires target attribute; constraint requires non-empty body text</output>
  <error case="missing-name">entity element without name attribute → block error</error>
  <error case="no-children">entity with zero field/relationship/constraint children → block error</error>
  <error case="field-no-name">field child without name attribute → block error</error>
  <error case="relationship-no-target">relationship child without target attribute → block error</error>
  <error case="empty-constraint">constraint child with empty body → block error</error>
</interface>

<interface name="validate-entity">
  <input>phase spec content containing `<entity>` XML elements</input>
  <output>errors[] for: missing name attr, zero children, field missing name, relationship missing target, empty constraint body. Warnings[] for concreteness (vague language in field descriptions)</output>
</interface>

<interface name="validate-missing-spec-promotion">
  <input>phase with no `<spec>` section + plan classification (type, complexity)</input>
  <output>error (block) if type is feature|migration|enhancement AND complexity is medium|complex. Warning (non-blocking) for all other types/complexities. Current line ~267 warning logic replaced with conditional</output>
</interface>

<interface name="validate-auth-on-endpoints">
  <input>endpoint element with method POST|DELETE|PATCH|PUT</input>
  <output>warning if: (a) no `<request>` child exists, OR (b) `<request>` body does not contain any of: JWT, auth, token, public, internal, network, api-key (case-insensitive). No warning for GET|HEAD|OPTIONS methods</output>
</interface>

<interface name="validate-semantic-warnings">
  <input>top-level `<relevant-files>` content + all phase spec content</input>
  <output>warning if relevant-files contains pattern matching schema|migration file paths AND no phase has `<entity>` element. Warning if relevant-files contains pattern matching route|handler|endpoint file paths AND no phase has `<endpoint>` element. Patterns: /schema/, /migration/, db/schema, .sql for entity; /routes/, /handlers/, /api/, /endpoints/ for endpoints</output>
</interface>

<interface name="parser-entity-support">
  <input>plan spec content with `<entity>` elements</input>
  <output>SpecType union includes "entity". parseSpecNames extracts entity name attributes. filterSpecsByRefs extracts `<entity name="X">...</entity>` blocks by name. Entity specs appear in specsByTask when referenced via Spec refs</output>
</interface>

<behavior name="security-clarification-question">
  <precondition>Step 3 clarification, plan relevant-files include route/API/middleware files OR plan type is feature/enhancement touching data mutations</precondition>
  <postcondition>at least one AskUserQuestion includes: "Para endpoints que criam, atualizam ou deletam dados: quem pode chamar cada um? O que acontece se um usuário não autorizado chamar?"</postcondition>
</behavior>

<behavior name="shared-types-question">
  <precondition>Step 3 clarification, map-project.ts output shows sibling repos, AND Explore agents found shared/ or shared/api/ or similar shared types directory in the project</precondition>
  <postcondition>AskUserQuestion includes: "Este projeto tem tipos compartilhados em X. Os builders devem importar de lá em vez de criar tipos locais?"</postcondition>
</behavior>

<behavior name="da-security-mandate-upgrade">
  <precondition>DA agent is running (not auto-skipped), plan has mutating endpoints in relevant-files</precondition>
  <postcondition>DA mandate includes: "For every mutating endpoint (POST/DELETE/PATCH/PUT) in relevant-files, verify an auth error-contract exists in the specs. Report as spec gap if missing."</postcondition>
</behavior>

<behavior name="da-shared-types-mandate">
  <precondition>DA agent is running, plan has `<secondary-repos>`</precondition>
  <postcondition>DA mandate includes: "Verify satellite repo tasks import from the shared types directory rather than creating local shadow types. Report as spec gap if local type definitions duplicate shared schemas."</postcondition>
</behavior>

<behavior name="builder-security-checklist">
  <precondition>builder self-verify step (step 6 in builder workflow), task touches routes/endpoints/middleware/data access</precondition>
  <postcondition>self-verify includes checks: (1) ownership validation on mutating endpoints, (2) no secrets/tokens in API response bodies, (3) auth middleware on non-public routes, (4) Zod schema validates strictly (no silent field stripping of auth-relevant data)</postcondition>
</behavior>

<error-contract name="selfbuild-detection-fix">
  <case trigger="post-merge, HEAD == originalBranch after checkout+merge" handling="save pre-merge commit hash via git rev-parse HEAD BEFORE checkout step; pass preMergeHash to detectSelfBuild; diff preMergeHash..HEAD instead of originalBranch..HEAD" />
  <case trigger="cleanup commits between merge and selfBuild check" handling="move detectSelfBuild call BEFORE archive/cleanup steps, or pass the merge-commit hash directly" />
</error-contract>

<error-contract name="worktree-removal-enoent">
  <case trigger="Bun.spawnSync git ENOENT during removeWorktree" handling="synchronous retry loop: up to 3 attempts with 500ms Bun.sleepSync between each; if all 3 fail, log warning with stderr and continue (set removed=false). Do NOT convert function to async" />
</error-contract>

<invariant>All changes are additive — existing valid plans continue to pass validation without modification</invariant>
<invariant>Plan Format section in talk.md defines entity element with same structure that validate-plan.ts validates</invariant>
</spec>

<tasks>
#### 1. Spec Validation and Parser Improvements
- **ID**: spec-validation-parser
- **Assigned To**: builder-1
- **Model**: opus
- **Effort**: high
- **Spec refs**: validate-entity, validate-missing-spec-promotion, validate-auth-on-endpoints, validate-semantic-warnings, parser-entity-support, entity-element-format
- Add `<entity>` structural validation to `scripts/validate-plan.ts`: name attr required, ≥1 child (field|relationship|constraint), field requires name attr, relationship requires target attr, constraint requires non-empty body. Apply concreteness check to entity field descriptions and constraint text
- In `scripts/validate-plan.ts`, replace the missing-spec warning (currently ~line 267) with conditional logic: error (push to errors[]) if plan type is feature|migration|enhancement AND complexity is medium|complex; warning for all other cases
- Add auth warning for mutating endpoints: when `<endpoint method="POST|DELETE|PATCH|PUT">` is found, check if `<request>` child exists AND contains auth-related keyword (JWT, auth, token, public, internal, network, api-key — case-insensitive). Warn if no `<request>` child OR no keyword match
- Add semantic warnings: read top-level `<relevant-files>` content from plan. If content matches schema/migration patterns (schema, migration, .sql, db/schema) AND no `<entity>` element exists across all phases → warning. If content matches route patterns (routes/, handlers/, api/, endpoints/) AND no `<endpoint>` element exists across all phases → warning
- In `scripts/lib/plan-parser.ts`: add "entity" to SpecType union. Update `parseSpecNames` to extract entity name attributes (regex: `<entity\s+name="([^"]+)"`). Update `filterSpecsByRefs` to extract `<entity name="X">...</entity>` blocks. Ensure entity elements flow through specsByTask when referenced via task Spec refs

#### 2. Planning Pipeline Security and Multi-Repo Improvements
- **ID**: talk-security-pipeline
- **Assigned To**: builder-2
- **Model**: opus
- **Effort**: high
- **Spec refs**: security-clarification-question, shared-types-question, da-security-mandate-upgrade, da-shared-types-mandate, entity-element-format
- In `commands/talk.md` Step 3 "What to ask about" section: add mandatory **Security** category: "Para endpoints que criam, atualizam ou deletam dados: quem pode chamar? O que acontece com acesso não autorizado? Ownership check necessário?" This should appear after the existing "Edge cases" bullet
- In `commands/talk.md` Step 3 "What to ask about" section: add **Shared types** category: "When Explore agents detect a shared types directory (shared/, shared/api/, etc.) AND the plan involves a sibling/satellite repo: ask whether builders should import from shared types instead of creating local definitions. Include as plan invariant if user confirms."
- In `commands/talk.md` Step 6b DA mandate section: add to the agent mandate list: "**Auth coverage** — For every mutating endpoint (POST/DELETE/PATCH/PUT) found in `<relevant-files>`, verify an auth `<error-contract>` exists in the specs. Report as spec gap if missing." AND "**Shared type shadows** — If the plan has `<secondary-repos>`, verify satellite tasks reference shared types from the primary repo rather than defining local shadow types. Report as spec gap if local definitions duplicate shared schemas."
- In `commands/talk.md` Plan Format section (the XML template): add `<entity>` element definition with field, relationship, constraint children. Add example showing the pattern. Add `<global-invariants>` as optional top-level plan section with description "Cross-cutting invariants that apply to all phases (e.g., API envelope format, auth patterns, error code registry). Validated structurally but not yet delivered per-task to builders." Update the Plan Format Rules bullet list to include entity and global-invariants

#### 3. Builder Security Checklist
- **ID**: builder-security-checklist
- **Assigned To**: builder-3
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: builder-security-checklist
- In both `agents/devorch-builder.md` and `agents/devorch-builder-deep.md`: update self-verify step (currently step 6) to add security checks after the existing CONTRACT MAP verification. Add: "**Security self-check** (always, regardless of CONTRACT MAP): If your task creates or modifies API routes, middleware, or data access code, verify: (1) Mutating endpoints (POST/DELETE/PATCH/PUT) check ownership (userId match or admin role), (2) Response bodies do not expose secrets, tokens, or internal IDs not meant for the client, (3) Auth middleware is applied to non-public routes, (4) Input validation is strict — Zod schemas should not silently strip fields that affect authorization."
- In both builder files: add to Red Flags table: `"Segurança pode esperar" | Ownership checks e auth são requisitos, não nice-to-have. IDOR é a vulnerabilidade #1 em APIs REST.`

#### 4. Merge Script Bug Fixes
- **ID**: merge-script-fixes
- **Assigned To**: builder-4
- **Model**: sonnet
- **Effort**: medium
- **Spec refs**: selfbuild-detection-fix, worktree-removal-enoent
- In `scripts/merge-worktree.ts`: fix selfBuild detection. Before the checkout step (~line 440 `doCheckout`), save the current HEAD: `const preMergeHash = git(mainRoot, ["rev-parse", "HEAD"]).stdout.trim()`. Update `detectSelfBuild` function signature to accept `preMergeHash: string` instead of using `originalBranch`. Change the diff command from `${originalBranch}..HEAD` to `${preMergeHash}..HEAD`. Update the call site (~line 472) to pass `preMergeHash`
- In `scripts/merge-worktree.ts`: fix ENOENT in worktree removal. In the `removeWorktree` function (~lines 276-290), wrap the `git worktree remove` call in a synchronous retry loop: up to 3 attempts, with `Bun.sleepSync(500)` between attempts. If all 3 attempts fail, log the error and set removed=false (do not throw). Keep the function synchronous — do NOT convert to async. The git branch -d call after removal does not need retry

</tasks>

<execution>
**Wave 1** (parallel): spec-validation-parser, talk-security-pipeline, builder-security-checklist, merge-script-fixes
</execution>

<criteria>
- [ ] `<entity>` elements are validated structurally in validate-plan.ts (name, children, child attrs)
- [ ] Plans of type feature|migration|enhancement with complexity ≥ medium are blocked if any phase lacks `<spec>`
- [ ] Mutating endpoints without auth annotation produce a validation warning
- [ ] Semantic warnings fire when relevant-files includes schema patterns but no entity spec exists
- [ ] plan-parser.ts parseSpecNames and filterSpecsByRefs handle entity elements correctly
- [ ] talk.md Step 3 includes security question category and shared-types question
- [ ] talk.md Step 6b DA mandate includes auth coverage and shared type shadow checks
- [ ] talk.md Plan Format defines `<entity>` element and `<global-invariants>` section
- [ ] Both builder agents include security checklist in self-verify step
- [ ] merge-worktree.ts selfBuild uses pre-merge hash instead of originalBranch
- [ ] merge-worktree.ts removeWorktree retries synchronously on failure
- [ ] Existing valid plans still pass validation (no false positive blocks)
</criteria>

</phase1>
