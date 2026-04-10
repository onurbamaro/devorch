# Explore Cache
Generated: 2026-04-10T00:00:00Z

## Validator & Plan Parser

### Type validation (validate-plan.ts:44)
Regex: `/Type:\s*(feature|fix|refactor|migration|chore|enhancement)/i`
Accepted: feature, fix, refactor, migration, chore, enhancement
Error: `"Classification: missing or invalid Type"` — no valid values listed
Note: "bugfix" is NOT valid — validator uses "fix". "infrastructure" also not valid.

### Spec ref matching (plan-parser.ts:98-126)
`parseSpecNames()` handles ALL spec tag types:
- `<interface>`, `<error-contract>`, `<behavior>`: matched by `name` attribute
- `<invariant>`: positional naming `invariant-1`, `invariant-2`...
- `<endpoint>`: auto-generated as `METHOD-/path` (e.g., `GET-/api/health`)

Error (validate-plan.ts:242): `"Phase N: task "tid" references unknown spec "ref""` — does NOT list available specs in the phase.

### Wave conflict detection (validate-plan.ts:278-350)
ALREADY IMPLEMENTED. Parses `<execution>` section, extracts file refs per task using backtick-quoted paths, checks all task pairs in each wave for overlap. Warning: `"Phase N: Wave W conflict — tasks "a" and "b" both touch: files"`.

### Classification error messages
All three fields (Type, Complexity, Risk) show generic "missing or invalid X" without listing valid values.

### Full error output format
On block: `{"result":"block","reason":"err1; err2; ...","warnings":[...]}`
On continue: `{"result":"continue","hash":"<sha256>","warnings":[...]}`

## Archive & Worktree Setup

### archive-plan.ts (lines 48-50)
DOES delete current.md — uses `copyFileSync` then `unlinkSync`. Deletion is unconditional.

### setup-worktree.ts worktree creation flow
1. Creates worktree via `git worktree add` — checks out current HEAD (if current.md is committed, it's in the worktree)
2. Copies uncommitted `.devorch/` files from source repo (lines 299-333) — filters out `explore-cache*.md` but NOT `current.md`
3. No flag or code to clean up `.devorch/plans/current.md` in the new worktree

Root cause: If current.md was committed to git before archiving, archive deletes the working copy but git checkout in the new worktree restores it from HEAD. The copy step also brings over any uncommitted current.md.

Fix needed: setup-worktree.ts should delete `.devorch/plans/current.md` in the new worktree after creation if it exists.

## Talk Command — DA & Clarify

### Devil's Advocate (talk.md:196-241)
DA receives 5 context items including explore-cache (line 204). BUT no instruction exists telling DA not to contradict confirmed exploration findings. Only instruction is "Do not fabricate findings" (line 213). Missing: explicit constraint that explore-cache confirmed facts should be treated as established evidence.

### Clarification step (talk.md:110-141)
No guidance about recommendation-with-opt-out when confidence is high. Mandate is "zero assumptions" with "no cap on rounds". Only related: "Don't ask the user to make decisions you're better equipped to make" (line 150 in 3b, not in step 3).

### Classification values in plan format (talk.md:608-612)
`<classification>` uses bare `<type>`, `<complexity>`, `<risk>` placeholders. NO enumeration of valid values anywhere in talk.md. The validator's accepted values are only discoverable by reading validate-plan.ts source.

### Endpoint documentation (talk.md:644-663)
`<endpoint path="/path" method="METHOD">` is documented with correct attributes. BUT the plan format does not document how endpoint spec refs work (i.e., that the ref should be `METHOD-/path`).

### build.md Type dependency
build.md has NO type-dependent behaviors. Classification Type is documentation-only metadata.
