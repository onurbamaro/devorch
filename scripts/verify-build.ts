/**
 * verify-build.ts — Verifies that new-files declared in a plan exist and are not stubs.
 * Usage: bun ~/.claude/devorch-scripts/verify-build.ts --plan <path>
 * Output: JSON {"totalFiles", "passed", "failed", "files": [{path, status, description, indicators?}]}
 */
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "./lib/args";
import { extractTagContent, readPlan } from "./lib/plan-parser";

interface FileResult {
  path: string;
  status: "ok" | "missing" | "empty" | "stub";
  description: string;
  indicators?: string[];
}

const args = parseArgs<{ plan: string }>([
  { name: "plan", type: "string", required: true },
]);

const content = readPlan(args.plan);

function extractNewFiles(text: string): { path: string; description: string }[] {
  const block = extractTagContent(text, "new-files");
  if (!block) return [];

  const files: { path: string; description: string }[] = [];
  const lines = block.split("\n");
  for (const line of lines) {
    const fileMatch = line.match(/^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/);
    if (fileMatch) {
      files.push({ path: fileMatch[1], description: fileMatch[2].trim() });
    }
  }
  return files;
}

function stripLiterals(line: string): string {
  return line
    .replace(/\/[^/\n]+\/[gimsuy]*/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/'[^']*'/g, "")
    .replace(/`[^`]*`/g, "");
}

function checkStub(filePath: string): string[] {
  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const indicators: string[] = [];
  const lines = fileContent.split("\n");

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

  const meaningfulLines = lines.filter((l) => {
    const trimmed = l.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
  });
  if (meaningfulLines.length < 3) {
    indicators.push(`Only ${meaningfulLines.length} non-empty, non-comment lines (likely placeholder)`);
  }

  return indicators;
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
