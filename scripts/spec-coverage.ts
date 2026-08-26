/**
 * spec-coverage.ts — Verifies that every plan spec has both an
 * implementation symbol and a test reference somewhere in the worktree.
 * Replaces the LLM "completeness reviewer" with a deterministic check.
 *
 * Usage: bun ~/.claude/devorch-scripts/spec-coverage.ts \
 *          --plan <plan.md> --worktree <path> [--repo <name>]
 * Output: JSON {ok, repo, totalSpecs, covered, missingImpl, missingTest, byPhase}
 *
 * Multi-repo plans: phases carry repo="<name>" and Files are prefixed
 * "<repoName>/". When any phase declares a repo, only the specs of phases
 * matching the target repo are checked against this worktree. The target repo
 * comes from --repo, or is inferred from the worktree path
 * (".../<repo>/.worktrees/<session>" → <repo>; otherwise the basename).
 *
 * Spec elements considered (must have name="..."):
 *   <behavior>, <invariant>, <endpoint path="...">, <entity>, <interface>, <error-contract>
 *
 * "Has implementation" = the name (or a kebab/snake/camel variant) appears
 * in any non-test file under the worktree (code, .md and .html included —
 * a CLI flag documented in a command .md or a single-file page count),
 * OR a non-test file listed in the **Files** of a task referencing the spec
 * exists in the worktree (builders — e.g. grok — don't name-tag code, so the
 * task's declared file set is the fallback evidence).
 * "Has test" = the name appears in any *.test.ts | *.spec.ts | *_test.go |
 * test_*.py | similar test-pattern file, OR a test-pattern file listed in the
 * referencing task's **Files** exists in the worktree.
 *
 * Coverage opt-outs (attribute on the spec element):
 *   coverage="visual-gate"  — validated by Gate 2 (screenshots vs baselines);
 *                             skips both greps, listed under `visualGate`.
 *   coverage="orchestrator" — implementation grep still required, but no
 *                             automated test exists by design (e.g. a contract
 *                             implemented in a command .md); skips the test grep.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, extname } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{ plan: string; worktree: string; repo?: string }>([
  { name: "plan", type: "string", required: true },
  { name: "worktree", type: "string", required: true },
  { name: "repo", type: "string", required: false },
]);

const planPath = resolve(args.plan);
const worktreePath = resolve(args.worktree);

if (!existsSync(planPath)) {
  console.log(JSON.stringify({ ok: false, error: `Plan not found: ${planPath}` }));
  process.exit(0);
}

const planContent = readFileSync(planPath, "utf-8");

// ===== Extract specs per phase =====

interface SpecEntry { name: string; kind: string; phase: string; coverage: "grep" | "visual-gate" | "orchestrator"; }
interface TaskEntry { files: string[]; specRefs: string[] | null; }
let specs: SpecEntry[] = [];
const phaseRepo: Record<string, string | undefined> = {};
const phaseTasks: Record<string, TaskEntry[]> = {};

const phaseRe = /<phase\s+([^>]*)>([\s\S]*?)<\/phase>/g;
let phaseMatch: RegExpExecArray | null;
while ((phaseMatch = phaseRe.exec(planContent)) !== null) {
  const attrs = phaseMatch[1];
  const phaseBody = phaseMatch[2];
  const phaseId = /\bid="([^"]+)"/.exec(attrs)?.[1];
  if (!phaseId) continue;
  phaseRepo[phaseId] = /\brepo="([^"]+)"/.exec(attrs)?.[1];

  // Tasks: **Files** (backtick paths) + optional **Spec refs** (comma list).
  // A task without Spec refs receives the full phase spec, so it references
  // every spec of its phase.
  phaseTasks[phaseId] = [];
  const tasksBlock = /<tasks>([\s\S]*?)<\/tasks>/.exec(phaseBody)?.[1] ?? "";
  for (const chunk of tasksBlock.split(/^####\s+/m).slice(1)) {
    const filesLine = /\*\*Files\*\*:\s*(.+)/.exec(chunk)?.[1] ?? "";
    const files = [...filesLine.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const refsLine = /\*\*Spec refs\*\*:\s*(.+)/.exec(chunk)?.[1];
    const specRefs = refsLine ? refsLine.split(",").map((r) => r.trim()).filter(Boolean) : null;
    if (files.length > 0) phaseTasks[phaseId].push({ files, specRefs });
  }

  const specBlock = /<spec>([\s\S]*?)<\/spec>/.exec(phaseBody)?.[1];
  if (!specBlock) continue;

  const KINDS = ["behavior", "invariant", "endpoint", "entity", "interface", "error-contract"];
  for (const kind of KINDS) {
    const elRe = new RegExp(`<${kind}[^>]*\\sname="([^"]+)"[^>]*`, "g");
    let em: RegExpExecArray | null;
    while ((em = elRe.exec(specBlock)) !== null) {
      const coverage = /coverage="visual-gate"/.test(em[0])
        ? "visual-gate"
        : /coverage="orchestrator"/.test(em[0])
          ? "orchestrator"
          : "grep";
      specs.push({ name: em[1], kind, phase: phaseId, coverage });
    }
  }
}

// ===== Multi-repo: keep only the specs of phases targeting this worktree =====

function inferRepoFromWorktree(path: string): string {
  const m = /\/([^/]+)\/\.worktrees\/[^/]+\/?$/.exec(path);
  if (m) return m[1];
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// parseArgs defaults optional strings to "" — `||`, not `??`.
const targetRepo = args.repo || inferRepoFromWorktree(worktreePath);
const multiRepo = Object.values(phaseRepo).some(Boolean);
if (multiRepo) {
  specs = specs.filter((s) => {
    const r = phaseRepo[s.phase];
    return !r || r === targetRepo;
  });
}

// ===== Walk worktree, separating impl files from test files =====

const TEST_PATTERNS = [
  /\.test\.[tj]sx?$/i,
  /\.spec\.[tj]sx?$/i,
  /_test\.go$/i,
  /\btest_[\w]+\.py$/i,
  /\b__tests__\b/i,
  /\b__specs__\b/i,
];
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  ".devorch", ".turbo", ".cache", ".worktrees", "vendor",
  "__pycache__", ".venv", "venv", "target", ".svelte-kit",
]);
const READ_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".go", ".rs", ".rb", ".java", ".kt", ".swift",
  ".sql", ".graphql", ".vue", ".svelte",
  ".md", ".html",
]);

const implContents: string[] = [];
const testContents: string[] = [];

function walk(dir: string) {
  let entries: import("fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".devorch") continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile()) {
      if (!READ_EXT.has(extname(e.name).toLowerCase())) continue;
      const isTest = TEST_PATTERNS.some((re) => re.test(full));
      try {
        const content = readFileSync(full, "utf-8");
        if (isTest) testContents.push(content);
        else implContents.push(content);
      } catch {}
    }
  }
}
walk(worktreePath);

// ===== Match specs against impl + test corpus =====

function variants(name: string): string[] {
  // Generate kebab/snake/camel/Pascal variants for fuzzy match
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length === 0) return [name];
  const camel = parts[0].toLowerCase() + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join("");
  const pascal = parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join("");
  const snake = parts.map((p) => p.toLowerCase()).join("_");
  const kebab = parts.map((p) => p.toLowerCase()).join("-");
  return [...new Set([name, camel, pascal, snake, kebab])];
}

function inCorpus(corpus: string[], names: string[]): boolean {
  for (const c of corpus) {
    for (const n of names) {
      if (n.length < 3) continue;
      if (c.includes(n)) return true;
    }
  }
  return false;
}

const covered: SpecEntry[] = [];
const missingImpl: SpecEntry[] = [];
const missingTest: SpecEntry[] = [];
const visualGate: SpecEntry[] = [];

// Fallback evidence: builders don't necessarily name-tag code with the spec
// name. A spec also counts as covered when the files DECLARED by the task(s)
// referencing it (task **Files**, repo prefix stripped) exist in the worktree —
// impl via a non-test file, test via a test-pattern file. A task without
// **Spec refs** references every spec of its phase (plan-format rule).
const DOC_EXT = new Set([".md", ".markdown", ".html", ".txt", ".rst"]);

function stripRepoPrefix(f: string, phase: string): string {
  for (const r of [phaseRepo[phase], targetRepo]) {
    if (r && f.startsWith(`${r}/`)) return f.slice(r.length + 1);
  }
  return f;
}

function filesEvidence(s: SpecEntry): { impl: boolean; test: boolean; docsOnly: boolean } {
  const out = { impl: false, test: false, docsOnly: false };
  let declaredAny = false;
  let declaredNonTest = false;
  let declaredNonDoc = false;
  let testExists = false;
  for (const t of phaseTasks[s.phase] ?? []) {
    if (t.specRefs && !t.specRefs.includes(s.name)) continue;
    for (const f of t.files) {
      const rel = stripRepoPrefix(f, s.phase);
      declaredAny = true;
      const isTest = TEST_PATTERNS.some((re) => re.test(rel));
      if (!isTest) declaredNonTest = true;
      if (!DOC_EXT.has(extname(rel).toLowerCase())) declaredNonDoc = true;
      if (!existsSync(join(worktreePath, rel))) continue;
      if (isTest) testExists = true;
      else out.impl = true;
    }
  }
  out.test = testExists;
  // A task whose deliverable IS a test (only test files declared): the
  // existing test file is the implementation (e.g. a contract that hardens an
  // existing test gate).
  if (!declaredNonTest && testExists) out.impl = true;
  // A docs-only deliverable (every declared file is .md/.html/...) has no
  // automated test by nature — behaves like coverage="orchestrator".
  out.docsOnly = declaredAny && !declaredNonDoc;
  return out;
}

// Test evidence is also accepted at PHASE level: a phase's <criteria> is the
// acceptance unit, and one task often carries the test file that pins a
// sibling task's behavior (e.g. an impl-only task + a test-rewrite task).
const phaseTestFileExists: Record<string, boolean> = {};
for (const [phase, tasks] of Object.entries(phaseTasks)) {
  phaseTestFileExists[phase] = tasks.some((t) =>
    t.files.some((f) => {
      const rel = stripRepoPrefix(f, phase);
      return TEST_PATTERNS.some((re) => re.test(rel)) && existsSync(join(worktreePath, rel));
    }),
  );
}

for (const s of specs) {
  if (s.coverage === "visual-gate") {
    visualGate.push(s);
    covered.push(s);
    continue;
  }
  const names = variants(s.name);
  const evidence = filesEvidence(s);
  const hasImpl = inCorpus(implContents, names) || evidence.impl;
  const hasTest = inCorpus(testContents, names) || evidence.test || phaseTestFileExists[s.phase] === true;
  if (!hasImpl) missingImpl.push(s);
  else if (s.coverage === "orchestrator" || evidence.docsOnly) covered.push(s);
  else if (!hasTest && testContents.length > 0) missingTest.push(s);
  else covered.push(s);
}

const byPhase: Record<string, { total: number; covered: number; missingImpl: string[]; missingTest: string[] }> = {};
for (const s of specs) {
  byPhase[s.phase] = byPhase[s.phase] || { total: 0, covered: 0, missingImpl: [], missingTest: [] };
  byPhase[s.phase].total += 1;
}
for (const s of covered) byPhase[s.phase].covered += 1;
for (const s of missingImpl) byPhase[s.phase].missingImpl.push(`${s.kind}:${s.name}`);
for (const s of missingTest) byPhase[s.phase].missingTest.push(`${s.kind}:${s.name}`);

const ok = missingImpl.length === 0 && missingTest.length === 0;

console.log(JSON.stringify({
  ok,
  repo: multiRepo ? targetRepo : undefined,
  totalSpecs: specs.length,
  covered: covered.length,
  missingImpl: missingImpl.map((s) => ({ name: s.name, kind: s.kind, phase: s.phase })),
  missingTest: missingTest.map((s) => ({ name: s.name, kind: s.kind, phase: s.phase })),
  visualGate: visualGate.map((s) => ({ name: s.name, kind: s.kind, phase: s.phase })),
  hasTestFiles: testContents.length > 0,
  byPhase,
}));
