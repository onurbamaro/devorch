/**
 * map-project.ts — Collects structural project info for orchestrator dispatch.
 * Usage: bun ~/.claude/devorch-scripts/map-project.ts [project-dir] [--persist]
 * --persist: writes output to .devorch/cache/project-map.md in addition to stdout.
 *
 * Sections: Structure (3-level tree), Scripts, Makefile Targets, Sibling Repos.
 * Tech stack and dependencies are intentionally omitted — they're one Read away
 * and don't inform dispatch decisions.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, basename, dirname, resolve, relative } from "path";

let cwd = process.cwd();
let persist = false;

const argv = process.argv.slice(2);
for (const arg of argv) {
  if (arg === "--persist") {
    persist = true;
  } else if (!arg.startsWith("--")) {
    cwd = arg;
  }
}

const MAX_TREE_DEPTH = 3;

const lines: string[] = [];
const push = (s: string) => lines.push(s);
const heading = (s: string) => {
  push("");
  push(`## ${s}`);
  push("");
};

const pkgPath = join(cwd, "package.json");
let pkg: Record<string, any> | null = null;
if (existsSync(pkgPath)) {
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    // ignore
  }
}

if (persist) {
  push(`Generated: ${new Date().toISOString()}`);
  push("");
}

push("# Project Map");
push("");
push(`**Directory**: \`${cwd}\``);

// --- Folder structure (3 levels) ---
heading("Structure");

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".devorch",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "vendor",
  ".svelte-kit",
]);

function listDir(dir: string, depth: number, prefix: string): void {
  if (depth > MAX_TREE_DEPTH) return;

  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter(
      (e) => !IGNORE.has(e.name) && !e.name.startsWith(".")
    );
  } catch {
    return;
  }

  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => e.isFile());

  for (const f of files) {
    push(`${prefix}${f.name}`);
  }

  for (const d of dirs) {
    push(`${prefix}${d.name}/`);
    listDir(join(dir, d.name), depth + 1, prefix + "  ");
  }
}

push("```");
push(`${basename(cwd)}/`);
listDir(cwd, 1, "  ");
push("```");

// --- Scripts (interactive flag warnings are the main signal) ---
if (pkg) {
  const scripts = pkg.scripts || {};
  const keys = Object.keys(scripts);
  if (keys.length > 0) {
    heading("Scripts");
    const INTERACTIVE_FLAGS = /\b--(watchAll|watch|interactive)\b/;
    for (const k of keys.slice(0, 15)) {
      const val = scripts[k];
      const warn = INTERACTIVE_FLAGS.test(val) ? " ⚠️ interactive" : "";
      push(`- \`${k}\`: ${val}${warn}`);
    }
    if (keys.length > 15) push(`- ... +${keys.length - 15} more`);
  }
}

// --- Makefile targets ---
const makefilePath = join(cwd, "Makefile");
if (existsSync(makefilePath)) {
  heading("Makefile Targets");
  try {
    const content = readFileSync(makefilePath, "utf-8");
    const targets = content
      .split("\n")
      .filter((l) => /^[a-zA-Z_-]+:/.test(l))
      .map((l) => l.split(":")[0])
      .slice(0, 10);
    for (const t of targets) {
      push(`- \`${t}\``);
    }
  } catch {
    push("(could not read Makefile)");
  }
}

// --- Sibling repos detection ---
interface SiblingRepo {
  name: string;
  relativePath: string;
  branch: string;
}

function detectSiblingRepos(cwd: string): SiblingRepo[] {
  const parentDir = resolve(cwd, "..");
  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return [];
  }

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
        { stderr: "pipe" }
      );
      if (gitCheck.exitCode !== 0) continue;

      const branchResult = Bun.spawnSync(
        ["git", "-C", siblingPath, "branch", "--show-current"],
        { stderr: "pipe" }
      );
      const branch = branchResult.stdout.toString().trim() || "HEAD";

      const relPath = relative(cwd, siblingPath).replaceAll("\\", "/");
      siblings.push({ name: entry.name, relativePath: relPath, branch });
    } catch {
      // ignore — not a git repo or git not available
    }
  }

  return siblings;
}

const siblingRepos = detectSiblingRepos(cwd);
if (siblingRepos.length > 0) {
  heading("Sibling Repos");
  for (const repo of siblingRepos) {
    push(`- \`${repo.name}\` — ${repo.relativePath} (branch: ${repo.branch})`);
  }
}

// --- Output ---
const finalOutput = lines.join("\n");
console.log(finalOutput);

if (persist) {
  const mapPath = join(cwd, ".devorch", "cache", "project-map.md");
  mkdirSync(dirname(mapPath), { recursive: true });
  writeFileSync(mapPath, finalOutput, "utf-8");
}
