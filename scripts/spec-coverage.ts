/**
 * spec-coverage.ts — Verifies that every plan spec has both an
 * implementation symbol and a test reference somewhere in the worktree.
 * Replaces the LLM "completeness reviewer" with a deterministic check.
 *
 * Usage: bun ~/.claude/devorch-scripts/spec-coverage.ts \
 *          --plan <plan.md> --worktree <path>
 * Output: JSON {ok, totalSpecs, covered, missingImpl, missingTest, byPhase}
 *
 * Spec elements considered (must have name="..."):
 *   <behavior>, <invariant>, <endpoint path="...">, <entity>, <interface>, <error-contract>
 *
 * "Has implementation" = the name (or a kebab/snake/camel variant) appears
 * in any non-test file under the worktree (code, .md and .html included —
 * a CLI flag documented in a command .md or a single-file page count).
 * "Has test" = the name appears in any *.test.ts | *.spec.ts | *_test.go |
 * test_*.py | similar test-pattern file.
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

const args = parseArgs<{ plan: string; worktree: string }>([
  { name: "plan", type: "string", required: true },
  { name: "worktree", type: "string", required: true },
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
const specs: SpecEntry[] = [];

const phaseRe = /<phase\s+id="([^"]+)"\s+name="[^"]+"[^>]*>([\s\S]*?)<\/phase>/g;
let phaseMatch: RegExpExecArray | null;
while ((phaseMatch = phaseRe.exec(planContent)) !== null) {
  const phaseId = phaseMatch[1];
  const phaseBody = phaseMatch[2];
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

for (const s of specs) {
  if (s.coverage === "visual-gate") {
    visualGate.push(s);
    covered.push(s);
    continue;
  }
  const names = variants(s.name);
  const hasImpl = inCorpus(implContents, names);
  const hasTest = inCorpus(testContents, names);
  if (!hasImpl) missingImpl.push(s);
  else if (s.coverage === "orchestrator") covered.push(s);
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
  totalSpecs: specs.length,
  covered: covered.length,
  missingImpl: missingImpl.map((s) => ({ name: s.name, kind: s.kind, phase: s.phase })),
  missingTest: missingTest.map((s) => ({ name: s.name, kind: s.kind, phase: s.phase })),
  visualGate: visualGate.map((s) => ({ name: s.name, kind: s.kind, phase: s.phase })),
  hasTestFiles: testContents.length > 0,
  byPhase,
}));
