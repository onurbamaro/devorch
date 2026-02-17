/**
 * archive-plan.ts — Archives a plan file to .devorch/plans/archive/ with date+kebab-case naming.
 * Usage: bun ~/.claude/devorch-scripts/archive-plan.ts --plan <path>
 * Output: JSON {"archived", "from", "to", "planName"}
 */
import { existsSync, readFileSync, copyFileSync, unlinkSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

function parseArgs(): { plan: string } {
  const args = process.argv.slice(2);
  let plan = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    }
  }
  if (!plan) {
    console.error("Usage: archive-plan.ts --plan <path>");
    process.exit(1);
  }
  return { plan };
}

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

const { plan: planPath } = parseArgs();
const resolved = resolve(planPath);

if (!existsSync(resolved)) {
  console.error(`Plan file not found: ${resolved}`);
  process.exit(1);
}

let content: string;
try {
  content = readFileSync(resolved, "utf-8");
} catch {
  console.error(`Could not read plan: ${resolved}`);
  process.exit(1);
}

// Extract plan name
const titleMatch = content.match(/^#\s+Plan:\s+(.+)$/m);
const planName = titleMatch ? titleMatch[1].trim() : "untitled";

// Generate archive filename
const now = new Date();
const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const kebabName = toKebabCase(planName);
const archiveFilename = `${dateStr}-${kebabName}.md`;

// Resolve archive directory relative to plan location
const planDir = dirname(resolved);
const archiveDir = resolve(planDir, "archive");
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
