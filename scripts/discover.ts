/**
 * discover.ts — Single-shot Stage 1 context loader for /devorch.
 * Replaces map-project.ts + load-context.ts: produces project structure,
 * sibling repos, gotchas, profile (with precedence), silenced standards,
 * all in one JSON output. Always exit 0.
 *
 * Usage: bun ~/.claude/devorch-scripts/discover.ts [project-dir]
 * Output: JSON {projectMap, siblingRepos, gotchas, gotchasLegacy,
 *               profile: {raw, source}, silencedStandards, warnings}
 *
 * Side-effect: writes project-map.md to <project-dir>/.devorch/cache/project-map.md.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, basename, dirname, resolve, relative } from "path";
import { homedir } from "os";

const cwd = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

// ===== Project map (markdown + structured sibling repos) =====

const MAX_TREE_DEPTH = 3;
const IGNORE = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build",
  ".devorch", ".turbo", ".cache", "__pycache__", ".venv", "venv",
  "target", "vendor", ".svelte-kit", ".worktrees",
]);

const lines: string[] = [];
const push = (s: string) => lines.push(s);
const heading = (s: string) => { push(""); push(`## ${s}`); push(""); };

const pkgPath = join(cwd, "package.json");
let pkg: Record<string, any> | null = null;
if (existsSync(pkgPath)) {
  try { pkg = JSON.parse(readFileSync(pkgPath, "utf-8")); } catch {}
}

push("# Project Map");
push("");
push(`**Directory**: \`${cwd}\``);
heading("Structure");

function listDir(dir: string, depth: number, prefix: string): void {
  if (depth > MAX_TREE_DEPTH) return;
  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter(
      (e) => !IGNORE.has(e.name) && !e.name.startsWith("."),
    );
  } catch { return; }
  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => e.isFile());
  for (const f of files) push(`${prefix}${f.name}`);
  for (const d of dirs) {
    push(`${prefix}${d.name}/`);
    listDir(join(dir, d.name), depth + 1, prefix + "  ");
  }
}

push("```");
push(`${basename(cwd)}/`);
listDir(cwd, 1, "  ");
push("```");

const TEST_SCRIPT_PATTERN = /\b(jest|vitest|bun\s+test|mocha|playwright|cypress|node\s+--test|tap|ava|deno\s+test)\b/i;
let hasTests = false;
if (pkg) {
  const scripts = pkg.scripts || {};
  const keys = Object.keys(scripts);
  if (keys.length > 0) {
    heading("Scripts");
    const INTERACTIVE_FLAGS = /\b--(watchAll|watch|interactive)\b/;
    for (const k of keys.slice(0, 15)) {
      const val = scripts[k];
      const warn = INTERACTIVE_FLAGS.test(val) ? " (interactive)" : "";
      push(`- \`${k}\`: ${val}${warn}`);
      if (TEST_SCRIPT_PATTERN.test(val) || k === "test") hasTests = true;
    }
    if (keys.length > 15) push(`- ... +${keys.length - 15} more`);
  }
  // Also check devDependencies for test frameworks
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const dep of Object.keys(allDeps)) {
    if (/^(jest|vitest|@vitest|mocha|playwright|cypress|@playwright|tap|ava)$/.test(dep)) hasTests = true;
  }
}

const makefilePath = join(cwd, "Makefile");
if (existsSync(makefilePath)) {
  heading("Makefile Targets");
  try {
    const content = readFileSync(makefilePath, "utf-8");
    const targets = content.split("\n")
      .filter((l) => /^[a-zA-Z_-]+:/.test(l))
      .map((l) => l.split(":")[0])
      .slice(0, 10);
    for (const t of targets) push(`- \`${t}\``);
  } catch { push("(could not read Makefile)"); }
}

interface SiblingRepo { name: string; relativePath: string; branch: string; }
function detectSiblingRepos(): SiblingRepo[] {
  const parentDir = resolve(cwd, "..");
  let entries: import("fs").Dirent[];
  try { entries = readdirSync(parentDir, { withFileTypes: true }); }
  catch { return []; }
  const resolvedCwd = resolve(cwd);
  const siblings: SiblingRepo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const siblingPath = join(parentDir, entry.name);
    if (resolve(siblingPath) === resolvedCwd) continue;
    try {
      const gitCheck = Bun.spawnSync(
        ["git", "-C", siblingPath, "rev-parse", "--git-dir"],
        { stderr: "pipe" },
      );
      if (gitCheck.exitCode !== 0) continue;
      const branchResult = Bun.spawnSync(
        ["git", "-C", siblingPath, "branch", "--show-current"],
        { stderr: "pipe" },
      );
      const branch = branchResult.stdout.toString().trim() || "HEAD";
      siblings.push({
        name: entry.name,
        relativePath: relative(cwd, siblingPath).replaceAll("\\", "/"),
        branch,
      });
    } catch {}
  }
  return siblings;
}

const siblingRepos = detectSiblingRepos();
if (siblingRepos.length > 0) {
  heading("Sibling Repos");
  for (const repo of siblingRepos) {
    push(`- \`${repo.name}\` — ${repo.relativePath} (branch: ${repo.branch})`);
  }
}

const projectMap = lines.join("\n");

// Persist to cache
try {
  const mapPath = join(cwd, ".devorch", "cache", "project-map.md");
  mkdirSync(dirname(mapPath), { recursive: true });
  writeFileSync(mapPath, projectMap, "utf-8");
} catch {
  // Best-effort persistence — don't fail the run
}

// ===== Context: gotchas + profile + silenced =====

function safeRead(path: string): string {
  try { return existsSync(path) ? readFileSync(path, "utf-8") : ""; }
  catch { return ""; }
}

const gotchas = safeRead(join(cwd, ".devorch", "GOTCHAS.md"));
const gotchasLegacy = gotchas ? "" : safeRead(join(cwd, ".devorch", "CONVENTIONS.md"));

const projectProfile = safeRead(join(cwd, ".devorch", "profile.yml"));
const userProfile = projectProfile ? "" : safeRead(join(homedir(), ".devorch", "profile.yml"));

const DEFAULT_PROFILE = `priorities:
  - security
  - performance
  - dx
  - cost
biases: {}
`;

let profileRaw: string;
let profileSource: "project" | "user-home" | "default";
if (projectProfile) { profileRaw = projectProfile; profileSource = "project"; }
else if (userProfile) { profileRaw = userProfile; profileSource = "user-home"; }
else { profileRaw = DEFAULT_PROFILE; profileSource = "default"; }

const silencedStandards = safeRead(join(cwd, ".devorch", "standards-silenced.md"));

console.log(JSON.stringify({
  projectMap,
  siblingRepos,
  hasTests,
  gotchas,
  gotchasLegacy,
  profile: { raw: profileRaw, source: profileSource },
  silencedStandards,
  warnings: [],
}));
