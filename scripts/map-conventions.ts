/**
 * map-conventions.ts — Analyzes code patterns and outputs Markdown conventions.
 * Usage: bun ~/.claude/devorch-scripts/map-conventions.ts [project-dir]
 *
 * Sections: Naming, Exports & Imports, Style, Error Handling, Patterns,
 * Active Workarounds, Gotchas, Testing, Component Patterns (if React).
 */
import { existsSync, readFileSync } from "fs";
import { join, extname, relative } from "path";
import { Project, SyntaxKind } from "ts-morph";
import { collectSampleFiles, LINES_TO_READ } from "./lib/fs-utils";

// Positional arg (shared lib doesn't handle positional args)
const cwd = process.argv[2] || process.cwd();

const lines: string[] = [];
const push = (s: string) => lines.push(s);
const heading = (s: string) => {
  push("");
  push(`## ${s}`);
  push("");
};

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

// --- Collect sample files ---
const testCount = { value: 0 };
const samples = collectSampleFiles(cwd, { trackTests: true, testCount });

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
  camelCase: 0, snake_case: 0, PascalCase: 0,
  namedExports: 0, defaultExports: 0,
  importStar: 0, importNamed: 0, importDefault: 0,
  semicolons: 0, noSemicolons: 0,
  singleQuotes: 0, doubleQuotes: 0,
  arrowFunctions: 0, regularFunctions: 0, asyncAwait: 0,
  tabs: 0, spaces2: 0, spaces4: 0,
};

// --- Error handling detection ---
interface ErrorHandlingStats {
  tryCatch: number;
  processExit: number;
  consoleError: number;
  silentCatch: number;
  throwInCatch: number;
}

const errorStats: ErrorHandlingStats = {
  tryCatch: 0, processExit: 0, consoleError: 0,
  silentCatch: 0, throwInCatch: 0,
};

// --- Comment mining ---
interface CommentEntry {
  keyword: string;
  file: string;
  line: number;
  text: string;
}

const comments: CommentEntry[] = [];

const fileContentCache = new Map<string, string>();

for (const file of samples) {
  try {
    const content = readFileSync(file, "utf-8");
    fileContentCache.set(file, content);
    const fileLines = content.split("\n").slice(0, LINES_TO_READ);
    const rel = relative(cwd, file);

    let inCatchBlock = false;
    let catchBraceDepth = 0;

    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];

      // --- Naming ---
      if (/const [a-z][a-zA-Z]+\s*=/.test(line)) patterns.camelCase++;
      if (/const [a-z]+_[a-z]+\s*=/.test(line)) patterns.snake_case++;
      if (/(class|interface|type)\s+[A-Z][a-zA-Z]+/.test(line)) patterns.PascalCase++;

      // --- Exports ---
      if (/^export (const|function|class|interface|type)\s/.test(line)) patterns.namedExports++;
      if (/^export default\s/.test(line)) patterns.defaultExports++;

      // --- Imports ---
      if (/import \* as/.test(line)) patterns.importStar++;
      if (/import \{/.test(line)) patterns.importNamed++;
      if (/import [A-Z]\w+ from/.test(line)) patterns.importDefault++;

      // --- Style ---
      if (/;\s*$/.test(line) && !line.includes("for")) patterns.semicolons++;
      if (/[^;]\s*$/.test(line) && line.trim().length > 5 && !/[{(,]$/.test(line.trim()))
        patterns.noSemicolons++;

      if (/'.+'/.test(line)) patterns.singleQuotes++;
      if (/".+"/.test(line)) patterns.doubleQuotes++;

      // --- Functions ---
      if (/=>\s*[{(]/.test(line) || /=>\s*\w/.test(line)) patterns.arrowFunctions++;
      if (/function\s+\w+/.test(line)) patterns.regularFunctions++;
      if (/async\s/.test(line) || /await\s/.test(line)) patterns.asyncAwait++;

      // --- Indentation ---
      if (/^\t/.test(line)) patterns.tabs++;
      if (/^ {2}\S/.test(line)) patterns.spaces2++;
      if (/^ {4}\S/.test(line)) patterns.spaces4++;

      // --- Error handling detection ---
      if (/\btry\s*\{/.test(line)) errorStats.tryCatch++;
      if (/\bprocess\.exit\(/.test(line)) errorStats.processExit++;
      if (/\bconsole\.error\(/.test(line)) errorStats.consoleError++;

      // Track catch blocks for silent vs throwing detection
      if (/\}\s*catch\b/.test(line) || /\bcatch\s*(\([^)]*\))?\s*\{/.test(line)) {
        inCatchBlock = true;
        catchBraceDepth = 1;
      } else if (inCatchBlock) {
        for (const ch of line) {
          if (ch === "{") catchBraceDepth++;
          if (ch === "}") catchBraceDepth--;
        }
        if (catchBraceDepth <= 0) {
          inCatchBlock = false;
        }
      }

      if (inCatchBlock) {
        if (/\bthrow\b/.test(line)) errorStats.throwInCatch++;
        // Silent catch: catch block with only comment or empty
        if (/\}\s*catch\b.*\{\s*$/.test(line)) {
          const nextLine = fileLines[i + 1]?.trim() ?? "";
          if (nextLine === "}" || nextLine.startsWith("//") || nextLine === "") {
            errorStats.silentCatch++;
          }
        }
      }

      // --- Comment mining ---
      const commentMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|NOTE|WORKAROUND)\b[:\s]*(.*)/i);
      if (commentMatch) {
        comments.push({
          keyword: commentMatch[1].toUpperCase(),
          file: rel,
          line: i + 1,
          text: commentMatch[2].trim(),
        });
      }

      // "because" in comments (case-insensitive)
      if (/\/\/.*\bbecause\b/i.test(line) && !commentMatch) {
        const becauseText = line.replace(/.*\/\/\s*/, "").trim();
        comments.push({
          keyword: "NOTE",
          file: rel,
          line: i + 1,
          text: becauseText,
        });
      }
    }
  } catch {
    continue;
  }
}

// --- ts-morph AST analysis ---
interface TsMorphFindings {
  functionSignatures: { file: string; name: string; signature: string }[];
  importClusters: Map<string, number>;
  moduleExports: { file: string; exportCount: number }[];
}

const tsMorphFindings: TsMorphFindings = {
  functionSignatures: [],
  importClusters: new Map(),
  moduleExports: [],
};

const TS_EXTS = new Set([".ts", ".tsx"]);

function runTsMorphAnalysis() {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  const tsFiles = samples.filter((f) => TS_EXTS.has(extname(f)));

  for (const file of tsFiles) {
    const rel = relative(cwd, file);
    try {
      const sourceFile = project.addSourceFileAtPath(file);

      // Extract function signatures
      for (const fn of sourceFile.getFunctions()) {
        const name = fn.getName() ?? "(anonymous)";
        const params = fn.getParameters().map((p) => {
          const typeText = p.getTypeNode()?.getText() ?? p.getType().getText();
          return `${p.getName()}: ${typeText}`;
        }).join(", ");
        const ret = fn.getReturnTypeNode()?.getText() ?? fn.getReturnType().getText();
        const asyncPrefix = fn.isAsync() ? "async " : "";
        tsMorphFindings.functionSignatures.push({
          file: rel,
          name,
          signature: `${asyncPrefix}${name}(${params}): ${ret}`,
        });
      }

      // Extract arrow function signatures from variable declarations
      for (const stmt of sourceFile.getVariableStatements()) {
        if (!stmt.isExported()) continue;
        for (const decl of stmt.getDeclarations()) {
          const init = decl.getInitializerIfKind(SyntaxKind.ArrowFunction);
          if (!init) continue;
          const name = decl.getName();
          const params = init.getParameters().map((p) => {
            const typeText = p.getTypeNode()?.getText() ?? p.getType().getText();
            return `${p.getName()}: ${typeText}`;
          }).join(", ");
          const ret = init.getReturnTypeNode()?.getText() ?? init.getReturnType().getText();
          const asyncPrefix = init.isAsync() ? "async " : "";
          tsMorphFindings.functionSignatures.push({
            file: rel,
            name,
            signature: `${asyncPrefix}${name}(${params}): ${ret}`,
          });
        }
      }

      // Import clusters
      for (const imp of sourceFile.getImportDeclarations()) {
        const from = imp.getModuleSpecifierValue();
        const key = from.startsWith(".") ? "(relative)" : from.split("/")[0];
        tsMorphFindings.importClusters.set(
          key,
          (tsMorphFindings.importClusters.get(key) || 0) + 1
        );
      }

      // Module export count
      const exportCount = sourceFile.getExportedDeclarations().size;
      if (exportCount > 0) {
        tsMorphFindings.moduleExports.push({ file: rel, exportCount });
      }

      // Remove source file to free memory
      project.removeSourceFile(sourceFile);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`map-conventions: ts-morph parse failed for ${rel}: ${reason}`);
      // Fallback: regex analysis already captured patterns above
    }
  }
}

runTsMorphAnalysis();

// --- Output sections ---

heading("Naming");

const winner = (a: [string, number], b: [string, number]) =>
  a[1] >= b[1] ? a[0] : b[0];

push(
  `- **Variables & constants**: ${winner(["camelCase", patterns.camelCase], ["snake_case", patterns.snake_case])}` +
    ` (camel: ${patterns.camelCase}, snake: ${patterns.snake_case})`
);
push(`- **Types/Classes**: PascalCase (${patterns.PascalCase} found)`);

heading("Exports & Imports");

push(
  `- **Exports**: ${winner(["named", patterns.namedExports], ["default", patterns.defaultExports])} preferred` +
    ` (named: ${patterns.namedExports}, default: ${patterns.defaultExports})`
);
push(`- **Imports**: named={${patterns.importNamed}} default={${patterns.importDefault}} star={${patterns.importStar}}`);

heading("Style");

push(
  `- **Semicolons**: ${patterns.semicolons > patterns.noSemicolons ? "yes" : "no"}` +
    ` (${patterns.semicolons} with, ${patterns.noSemicolons} without)`
);
push(
  `- **Quotes**: ${patterns.singleQuotes >= patterns.doubleQuotes ? "single" : "double"}` +
    ` (single: ${patterns.singleQuotes}, double: ${patterns.doubleQuotes})`
);
push(
  `- **Functions**: ${patterns.arrowFunctions >= patterns.regularFunctions ? "arrow" : "regular"} preferred` +
    ` (arrow: ${patterns.arrowFunctions}, regular: ${patterns.regularFunctions})`
);
push(`- **Async/await**: ${patterns.asyncAwait} occurrences`);

const indent =
  patterns.tabs > patterns.spaces2 && patterns.tabs > patterns.spaces4
    ? "tabs"
    : patterns.spaces2 > patterns.spaces4
      ? "2 spaces"
      : "4 spaces";
push(`- **Indentation**: ${indent}`);

// --- Error Handling section ---
heading("Error Handling");

if (errorStats.tryCatch > 0 || errorStats.processExit > 0) {
  push(`- try/catch blocks: ${errorStats.tryCatch}`);
  if (errorStats.silentCatch > 0) {
    push(`- Silent catch (swallow errors): ${errorStats.silentCatch}`);
  }
  if (errorStats.throwInCatch > 0) {
    push(`- Re-throw in catch: ${errorStats.throwInCatch}`);
  }
  if (errorStats.processExit > 0) {
    push(`- process.exit() calls: ${errorStats.processExit}`);
  }
  if (errorStats.consoleError > 0) {
    push(`- console.error() calls: ${errorStats.consoleError}`);
  }

  // Determine dominant pattern
  if (errorStats.silentCatch >= errorStats.throwInCatch && errorStats.silentCatch > 0) {
    push("- **Pattern**: Silent fallback (errors caught and swallowed)");
  } else if (errorStats.throwInCatch > 0) {
    push("- **Pattern**: Catch and re-throw (errors propagated)");
  }
  if (errorStats.processExit > 0 && errorStats.consoleError > 0) {
    push("- **Exit strategy**: console.error() then process.exit()");
  }
} else {
  push("- No explicit error handling detected in sampled files");
}

// --- Patterns section (enhanced with ts-morph) ---
heading("Patterns");

// Import clusters from ts-morph
if (tsMorphFindings.importClusters.size > 0) {
  const sorted = [...tsMorphFindings.importClusters.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  push("**Import clusters** (most frequent):");
  for (const [mod, count] of sorted) {
    push(`- \`${mod}\`: ${count} imports`);
  }
  push("");
}

// Function signatures by pattern
if (tsMorphFindings.functionSignatures.length > 0) {
  const asyncFns = tsMorphFindings.functionSignatures.filter((f) => f.signature.startsWith("async"));
  const syncFns = tsMorphFindings.functionSignatures.filter((f) => !f.signature.startsWith("async"));

  push("**Function signatures** (from AST):");
  const showSigs = tsMorphFindings.functionSignatures.slice(0, 15);
  for (const sig of showSigs) {
    push(`- \`${sig.signature}\` (\`${sig.file}\`)`);
  }
  if (tsMorphFindings.functionSignatures.length > 15) {
    push(`- ... and ${tsMorphFindings.functionSignatures.length - 15} more`);
  }
  push("");
  push(`Async/sync ratio: ${asyncFns.length} async, ${syncFns.length} sync`);
  push("");
}

// Module boundaries
if (tsMorphFindings.moduleExports.length > 0) {
  const sorted = tsMorphFindings.moduleExports
    .sort((a, b) => b.exportCount - a.exportCount)
    .slice(0, 8);
  push("**Module boundaries** (exports per file):");
  for (const mod of sorted) {
    push(`- \`${mod.file}\`: ${mod.exportCount} exports`);
  }
  push("");
}

// Fallback if no ts-morph findings
if (
  tsMorphFindings.importClusters.size === 0 &&
  tsMorphFindings.functionSignatures.length === 0
) {
  push("- No AST-level patterns extracted (ts-morph analysis unavailable or no TS files)");
}

// --- Active Workarounds section ---
const workaroundKeywords = new Set(["HACK", "WORKAROUND", "NOTE"]);
const workarounds = comments.filter((c) => workaroundKeywords.has(c.keyword));

if (workarounds.length > 0) {
  heading("Active Workarounds");
  for (const w of workarounds) {
    push(`- **${w.keyword}** \`${w.file}:${w.line}\`: ${w.text}`);
  }
}

// --- Gotchas section ---
const gotchaKeywords = new Set(["TODO", "FIXME"]);
const gotchas = comments.filter((c) => gotchaKeywords.has(c.keyword));

if (gotchas.length > 0) {
  heading("Gotchas");
  for (const g of gotchas) {
    push(`- **${g.keyword}** \`${g.file}:${g.line}\`: ${g.text}`);
  }
}

// --- Test detection ---
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
if (testCount.value > 0) {
  push(`- Colocated tests (.test./.spec.): ${testCount.value} files in src/`);
}
if (testDirs.length === 0 && testCount.value === 0) {
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
