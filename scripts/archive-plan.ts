/**
 * archive-plan.ts — Archives a plan file to .devorch/plans/archive/ with date+kebab-case naming.
 * Usage: bun ~/.claude/devorch-scripts/archive-plan.ts --plan <path>
 * Output: JSON {"archived", "from", "to", "planName"}
 */
import { existsSync, readFileSync, copyFileSync, unlinkSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{ plan: string }>([
  { name: "plan", type: "string", required: true },
]);

const planPath = args.plan;
const resolved = resolve(planPath);

if (!existsSync(resolved)) {
  console.error(`Plan file not found: ${resolved}`);
  process.exit(1);
}

const content = readFileSync(resolved, "utf-8");
const titleMatch = content.match(/^#\s+Plan:\s+(.+)$/m);
const planName = titleMatch ? titleMatch[1].trim() : "Untitled Plan";

const kebab = planName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .replace(/-{2,}/g, "-");

const now = new Date();
const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const archiveFilename = `${dateStr}-${kebab}.md`;

const archiveDir = resolve(dirname(resolved), "archive");
const archivePath = resolve(archiveDir, archiveFilename);

mkdirSync(archiveDir, { recursive: true });
copyFileSync(resolved, archivePath);
unlinkSync(resolved);

// Stage with -f because `.devorch/` is commonly gitignored even when
// `archive/` is convention-tracked. -u stages the deletion of the active
// plan only if it was tracked (no-op if untracked). Both calls are
// best-effort: silent failure if not in a git repo.
const projectRoot = resolve(dirname(resolved), "../..");
const gitOpts = { cwd: projectRoot, stderr: "pipe" as const, stdout: "pipe" as const };
let staged = false;
try {
  const addArchive = Bun.spawnSync(["git", "add", "-f", archivePath], gitOpts);
  if (addArchive.exitCode === 0) staged = true;
  Bun.spawnSync(["git", "add", "-u", resolved], gitOpts);
} catch {
  // git unavailable — skip silently
}

console.log(JSON.stringify({
  archived: true,
  from: planPath,
  to: archivePath.replaceAll("\\", "/"),
  planName,
  staged,
}));
