/**
 * archive-plan.ts — Archives a plan file to .devorch/plans/archive/ with date+kebab-case naming.
 * Usage: bun ~/.claude/devorch-scripts/archive-plan.ts --plan <path>
 * Output: JSON {"archived", "from", "to", "planName"}
 */
import { existsSync, copyFileSync, unlinkSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { parseArgs } from "./lib/args";
import { readPlan, extractPlanTitle } from "./lib/plan-parser";

const args = parseArgs<{ plan: string; "target-root": string }>([
  { name: "plan", type: "string", required: true },
  { name: "target-root", type: "string", required: false },
]);

const planPath = args.plan;
const resolved = resolve(planPath);

if (!existsSync(resolved)) {
  console.error(`Plan file not found: ${resolved}`);
  process.exit(1);
}

const content = readPlan(resolved);
const planName = extractPlanTitle(content);

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// Generate archive filename
const now = new Date();
const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const kebabName = toKebabCase(planName);
const archiveFilename = `${dateStr}-${kebabName}.md`;

// Resolve archive directory: use --target-root if provided, otherwise relative to plan location
const planDir = dirname(resolved);
const targetRoot = args["target-root"];
const archiveDir = targetRoot
  ? resolve(targetRoot, ".devorch/plans/archive")
  : resolve(planDir, "archive");
const archivePath = resolve(archiveDir, archiveFilename);

// Create archive directory
mkdirSync(archiveDir, { recursive: true });

// Copy then delete
copyFileSync(resolved, archivePath);
unlinkSync(resolved);

console.log(JSON.stringify({
  archived: true,
  from: planPath,
  to: archivePath.replaceAll("\\", "/"),
  planName,
}));
