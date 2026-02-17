/**
 * verify-build.ts — Verifies that new-files declared in a plan exist and are not stubs.
 * Usage: bun ~/.claude/devorch-scripts/verify-build.ts --plan <path>
 * Output: JSON {"totalFiles", "passed", "failed", "files": [{path, status, description, indicators?}]}
 */
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";

function parseArgs(): { plan: string } {
  const args = process.argv.slice(2);
  let plan = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    }
  }
  if (!plan) {
    console.error("Usage: verify-build.ts --plan <path>");
    process.exit(1);
  }
  return { plan };
}

interface FileResult {
  path: string;
  status: "ok" | "missing" | "empty" | "stub";
  description: string;
  indicators?: string[];
}

function extractNewFiles(content: string): { path: string; description: string }[] {
  const match = content.match(/<new-files>([\s\S]*?)<\/new-files>/i);
  if (!match) return [];

  const files: { path: string; description: string }[] = [];
  const lines = match[1].split("\n");
  for (const line of lines) {
    const fileMatch = line.match(/^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/);
    if (fileMatch) {
      files.push({ path: fileMatch[1], description: fileMatch[2].trim() });
    }
  }
  return files;
}

function stripLiterals(line: string): string {
  // Remove regex literals, string literals, and template expressions to avoid false positives
  return line
    .replace(/\/[^/\n]+\/[gimsuy]*/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/'[^']*'/g, "")
    .replace(/`[^`]*`/g, "");
}

function checkStub(filePath: string): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const indicators: string[] = [];
  const lines = content.split("\n");

  // Check for standalone stub keywords (strip literals to avoid false positives on detection code)
  for (let i = 0; i < lines.length; i++) {
    const cleaned = stripLiterals(lines[i]);
    if (/\bTODO\b/i.test(cleaned)) {
      indicators.push(`TODO found on line ${i + 1}`);
    }
    if (/\bFIXME\b/i.test(cleaned)) {
      indicators.push(`FIXME found on line ${i + 1}`);
    }
    if (/\bPLACEHOLDER\b/i.test(cleaned)) {
      indicators.push(`PLACEHOLDER found on line ${i + 1}`);
    }
    if (/throw\s+new\s+Error\(\s*["']not implemented["']\s*\)/i.test(lines[i])) {
      indicators.push(`throw not-implemented found on line ${i + 1}`);
    }
    if (/throw\s+new\s+Error\(\s*["']TODO["']\s*\)/i.test(lines[i])) {
      indicators.push(`throw TODO found on line ${i + 1}`);
    }
  }

  // Check for too few meaningful lines
  const meaningfulLines = lines.filter((l) => {
    const trimmed = l.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
  });
  if (meaningfulLines.length < 3) {
    indicators.push(`Only ${meaningfulLines.length} non-empty, non-comment lines (likely placeholder)`);
  }

  return indicators;
}

const { plan: planPath } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

const declaredFiles = extractNewFiles(content);

if (declaredFiles.length === 0) {
  console.log(JSON.stringify({ totalFiles: 0, passed: 0, failed: 0, files: [] }));
  process.exit(0);
}

const results: FileResult[] = [];
let passed = 0;
let failed = 0;

for (const { path: filePath, description } of declaredFiles) {
  const resolved = resolve(process.cwd(), filePath);

  if (!existsSync(resolved)) {
    results.push({ path: filePath, status: "missing", description });
    failed++;
    continue;
  }

  const stat = statSync(resolved);
  if (stat.size === 0) {
    results.push({ path: filePath, status: "empty", description });
    failed++;
    continue;
  }

  const stubIndicators = checkStub(resolved);
  if (stubIndicators.length > 0) {
    results.push({ path: filePath, status: "stub", description, indicators: stubIndicators });
    failed++;
    continue;
  }

  results.push({ path: filePath, status: "ok", description });
  passed++;
}

console.log(JSON.stringify({
  totalFiles: declaredFiles.length,
  passed,
  failed,
  files: results,
}));
