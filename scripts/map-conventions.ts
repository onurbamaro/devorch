/**
 * map-conventions.ts — Analyzes code patterns and outputs ~50 lines of Markdown.
 * Usage: bun ~/.claude/devorch-scripts/map-conventions.ts [project-dir]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

// Positional arg (shared lib doesn't handle positional args)
const cwd = process.argv[2] || process.cwd();

const lines: string[] = [];
const push = (s: string) => lines.push(s);
const heading = (s: string) => {
  push("");
  push(`## ${s}`);
  push("");
};

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go",
  ".java", ".kt", ".rb", ".ex", ".exs", ".vue", ".svelte",
]);

const SAMPLE_DIRS = ["src", "lib", "app", "components", "pages", "routes", "server", "api", "utils", "hooks", "services"];

const IGNORE = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".venv", "venv", "target", "vendor", ".svelte-kit", ".turbo",
]);

// --- Parse package.json once ---
const pkgPath = join(cwd, "package.json");
let pkgContent: string | null = null;
if (existsSync(pkgPath)) {
  try {
    pkgContent = readFileSync(pkgPath, "utf-8");
  } catch {
    // ignore
  }
}

// --- Collect files + colocated test count in a single traversal ---
let colocatedTests = 0;

function collectFiles(dir: string, maxPerDir: number, trackTests: boolean): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;

  try {
    const entries = readdirSync(dir).filter((e) => !IGNORE.has(e) && !e.startsWith("."));
    let count = 0;

    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isFile()) {
          if (trackTests && (/\.test\./.test(entry) || /\.spec\./.test(entry))) {
            colocatedTests++;
          }
          if (CODE_EXTS.has(extname(entry))) {
            result.push(full);
            count++;
            if (count >= maxPerDir) break;
          }
        } else if (stat.isDirectory() && result.length < maxPerDir * 3) {
          result.push(...collectFiles(full, 2, trackTests));
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }

  return result;
}

// --- Collect sample files (tracks colocated tests for src/) ---
const allSamples: string[] = [];

for (const d of SAMPLE_DIRS) {
  const dir = join(cwd, d);
  if (existsSync(dir)) {
    allSamples.push(...collectFiles(dir, 5, d === "src"));
  }
}

// Fallback: root src files
if (allSamples.length === 0) {
  allSamples.push(...collectFiles(cwd, 10, false));
}

// Limit total
const samples = allSamples.slice(0, 12);

push("# Code Conventions");
push("");
push(`**Analyzed**: ${samples.length} files`);

// --- Analyze patterns (cache file contents for reuse) ---
interface Patterns {
  camelCase: number;
  snake_case: number;
  PascalCase: number;
  namedExports: number;
  defaultExports: number;
  importStar: number;
  importNamed: number;
  importDefault: number;
  semicolons: number;
  noSemicolons: number;
  singleQuotes: number;
  doubleQuotes: number;
  arrowFunctions: number;
  regularFunctions: number;
  asyncAwait: number;
  tabs: number;
  spaces2: number;
  spaces4: number;
}

const patterns: Patterns = {
  camelCase: 0,
  snake_case: 0,
  PascalCase: 0,
  namedExports: 0,
  defaultExports: 0,
  importStar: 0,
  importNamed: 0,
  importDefault: 0,
  semicolons: 0,
  noSemicolons: 0,
  singleQuotes: 0,
  doubleQuotes: 0,
  arrowFunctions: 0,
  regularFunctions: 0,
  asyncAwait: 0,
  tabs: 0,
  spaces2: 0,
  spaces4: 0,
};

const fileContentCache = new Map<string, string>();

for (const file of samples) {
  try {
    const content = readFileSync(file, "utf-8");
    fileContentCache.set(file, content);
    const fileLines = content.split("\n").slice(0, 50);

    for (const line of fileLines) {
      // Naming
      if (/const [a-z][a-zA-Z]+\s*=/.test(line)) patterns.camelCase++;
      if (/const [a-z]+_[a-z]+\s*=/.test(line)) patterns.snake_case++;
      if (/(class|interface|type)\s+[A-Z][a-zA-Z]+/.test(line)) patterns.PascalCase++;

      // Exports
      if (/^export (const|function|class|interface|type)\s/.test(line)) patterns.namedExports++;
      if (/^export default\s/.test(line)) patterns.defaultExports++;

      // Imports
      if (/import \* as/.test(line)) patterns.importStar++;
      if (/import \{/.test(line)) patterns.importNamed++;
      if (/import [A-Z]\w+ from/.test(line)) patterns.importDefault++;

      // Style
      if (/;\s*$/.test(line) && !line.includes("for")) patterns.semicolons++;
      if (/[^;]\s*$/.test(line) && line.trim().length > 5 && !/[{(,]$/.test(line.trim()))
        patterns.noSemicolons++;

      if (/'.+'/.test(line)) patterns.singleQuotes++;
      if (/".+"/.test(line)) patterns.doubleQuotes++;

      // Functions
      if (/=>\s*[{(]/.test(line) || /=>\s*\w/.test(line)) patterns.arrowFunctions++;
      if (/function\s+\w+/.test(line)) patterns.regularFunctions++;
      if (/async\s/.test(line) || /await\s/.test(line)) patterns.asyncAwait++;

      // Indentation
      if (/^\t/.test(line)) patterns.tabs++;
      if (/^ {2}\S/.test(line)) patterns.spaces2++;
      if (/^ {4}\S/.test(line)) patterns.spaces4++;
    }
  } catch {
    continue;
  }
}

heading("Naming");

const winner = (a: [string, number], b: [string, number]) =>
  a[1] >= b[1] ? a[0] : b[0];

push(
  `- Variables: **${winner(["camelCase", patterns.camelCase], ["snake_case", patterns.snake_case])}**` +
    ` (camel: ${patterns.camelCase}, snake: ${patterns.snake_case})`
);
push(`- Types/Classes: **PascalCase** (${patterns.PascalCase} found)`);

heading("Exports & Imports");

push(
  `- Exports: **${winner(["named", patterns.namedExports], ["default", patterns.defaultExports])}** preferred` +
    ` (named: ${patterns.namedExports}, default: ${patterns.defaultExports})`
);
push(`- Imports: named={${patterns.importNamed}} default={${patterns.importDefault}} star={${patterns.importStar}}`);

heading("Style");

push(
  `- Semicolons: **${patterns.semicolons > patterns.noSemicolons ? "yes" : "no"}**` +
    ` (${patterns.semicolons} with, ${patterns.noSemicolons} without)`
);
push(
  `- Quotes: **${patterns.singleQuotes >= patterns.doubleQuotes ? "single" : "double"}**` +
    ` (single: ${patterns.singleQuotes}, double: ${patterns.doubleQuotes})`
);
push(
  `- Functions: **${patterns.arrowFunctions >= patterns.regularFunctions ? "arrow" : "regular"}**` +
    ` (arrow: ${patterns.arrowFunctions}, regular: ${patterns.regularFunctions})`
);
push(`- Async/await usage: ${patterns.asyncAwait} occurrences`);

const indent =
  patterns.tabs > patterns.spaces2 && patterns.tabs > patterns.spaces4
    ? "tabs"
    : patterns.spaces2 > patterns.spaces4
      ? "2 spaces"
      : "4 spaces";
push(`- Indentation: **${indent}**`);

// --- Test detection (using cached data) ---
heading("Testing");

const testPatterns = [
  { dir: "__tests__", label: "__tests__/ directory" },
  { dir: "test", label: "test/ directory" },
  { dir: "tests", label: "tests/ directory" },
  { dir: "spec", label: "spec/ directory" },
];

const testDirs = testPatterns.filter((p) => existsSync(join(cwd, p.dir)));

let testFramework = "unknown";
if (pkgContent) {
  if (pkgContent.includes("vitest")) testFramework = "vitest";
  else if (pkgContent.includes("jest")) testFramework = "jest";
  else if (pkgContent.includes("mocha")) testFramework = "mocha";
  else if (pkgContent.includes("ava")) testFramework = "ava";
  else if (pkgContent.includes("playwright")) testFramework = "playwright";
  else if (pkgContent.includes("cypress")) testFramework = "cypress";
}

if (testDirs.length > 0) {
  push(`- Test directories: ${testDirs.map((t) => t.label).join(", ")}`);
}
if (colocatedTests > 0) {
  push(`- Colocated tests (.test./.spec.): ${colocatedTests} files in src/`);
}
if (testDirs.length === 0 && colocatedTests === 0) {
  push("- No tests detected");
}
push(`- Test framework: **${testFramework}**`);

// --- Component patterns (using cached file contents) ---
const hasReact = [...fileContentCache.values()].some(
  (content) => content.includes("from 'react'") || content.includes('from "react"')
);

if (hasReact || samples.some((f) => f.endsWith(".tsx") || f.endsWith(".jsx"))) {
  heading("Component Patterns");

  let functionalComponents = 0;
  let classComponents = 0;
  let hooksUsage = 0;

  for (const file of samples) {
    if (!file.endsWith(".tsx") && !file.endsWith(".jsx")) continue;
    const content = fileContentCache.get(file);
    if (!content) continue;

    if (/export (default )?function \w+/.test(content) || /const \w+ = \(/.test(content))
      functionalComponents++;
    if (/class \w+ extends (React\.)?Component/.test(content)) classComponents++;
    if (/use[A-Z]\w+\(/.test(content)) hooksUsage++;
  }

  push(`- Functional components: ${functionalComponents}`);
  push(`- Class components: ${classComponents}`);
  push(`- Hooks usage: ${hooksUsage} files`);
}

// --- Output ---
console.log(lines.join("\n"));
