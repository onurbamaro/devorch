/**
 * map-project.ts — Collects project info and outputs ~80 lines of Markdown.
 * Usage: bun ~/.claude/devorch-scripts/map-project.ts [project-dir] [--persist]
 * --persist: writes output to .devorch/project-map.md in addition to stdout.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, basename, dirname } from "path";

// Positional + flag args (shared lib doesn't handle positional args)
let cwd = process.cwd();
let persist = false;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--persist") {
    persist = true;
  } else if (!argv[i].startsWith("--")) {
    cwd = argv[i];
  }
}

const lines: string[] = [];
const push = (s: string) => lines.push(s);
const heading = (s: string) => {
  push("");
  push(`## ${s}`);
  push("");
};

// --- Parse package.json once ---
const pkgPath = join(cwd, "package.json");
let pkg: Record<string, any> | null = null;
if (existsSync(pkgPath)) {
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    // ignore
  }
}

// --- Detect tech stack ---
interface StackFile {
  file: string;
  tech: string;
}

const stackFiles: StackFile[] = [
  { file: "package.json", tech: "Node.js / JavaScript" },
  { file: "bun.lockb", tech: "Bun" },
  { file: "bun.lock", tech: "Bun" },
  { file: "pnpm-lock.yaml", tech: "pnpm" },
  { file: "yarn.lock", tech: "Yarn" },
  { file: "package-lock.json", tech: "npm" },
  { file: "pyproject.toml", tech: "Python" },
  { file: "requirements.txt", tech: "Python" },
  { file: "Cargo.toml", tech: "Rust" },
  { file: "go.mod", tech: "Go" },
  { file: "build.gradle", tech: "Java/Kotlin (Gradle)" },
  { file: "pom.xml", tech: "Java (Maven)" },
  { file: "Gemfile", tech: "Ruby" },
  { file: "mix.exs", tech: "Elixir" },
  { file: "pubspec.yaml", tech: "Dart/Flutter" },
  { file: "composer.json", tech: "PHP" },
  { file: "tsconfig.json", tech: "TypeScript" },
];

if (persist) {
  push(`Generated: ${new Date().toISOString()}`);
  push("");
}

push("# Project Map");
push("");
push(`**Directory**: \`${cwd}\``);

heading("Tech Stack");

const detected: string[] = [];
for (const { file, tech } of stackFiles) {
  if (existsSync(join(cwd, file))) {
    detected.push(tech);
  }
}
if (detected.length === 0) detected.push("Unknown");
push(detected.map((t) => `- ${t}`).join("\n"));

// --- Folder structure (2 levels, using withFileTypes) ---
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
  if (depth > 2) return;
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

  for (const f of files.slice(0, 5)) {
    push(`${prefix}${f.name}`);
  }
  if (files.length > 5) {
    push(`${prefix}... +${files.length - 5} files`);
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

// --- Dependencies (top 15, using cached pkg) ---
if (pkg) {
  heading("Dependencies (top 15)");
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});

  if (deps.length > 0) {
    push("**Production:**");
    for (const d of deps.slice(0, 15)) {
      push(`- ${d}: ${pkg.dependencies[d]}`);
    }
    if (deps.length > 15) push(`- ... +${deps.length - 15} more`);
  }

  if (devDeps.length > 0) {
    push("");
    push("**Dev:**");
    for (const d of devDeps.slice(0, 10)) {
      push(`- ${d}: ${pkg.devDependencies[d]}`);
    }
    if (devDeps.length > 10) push(`- ... +${devDeps.length - 10} more`);
  }
}

// --- Scripts (using cached pkg) ---
if (pkg) {
  heading("Scripts");
  const scripts = pkg.scripts || {};
  const keys = Object.keys(scripts);
  if (keys.length > 0) {
    for (const k of keys.slice(0, 15)) {
      push(`- \`${k}\`: ${scripts[k]}`);
    }
    if (keys.length > 15) push(`- ... +${keys.length - 15} more`);
  } else {
    push("(no scripts defined)");
  }
}

// Makefile targets
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

// --- Git log (last 10 commits) ---
heading("Recent Commits");

try {
  const result = Bun.spawnSync(
    ["git", "log", "--oneline", "-10", "--no-decorate"],
    { cwd, stderr: "pipe" }
  );
  const output = result.stdout.toString().trim();
  if (output) {
    push("```");
    push(output);
    push("```");
  } else {
    push("(no git history or not a git repo)");
  }
} catch {
  push("(git not available)");
}

// --- Output ---
const finalOutput = lines.join("\n");
console.log(finalOutput);

// --- Persist ---
if (persist) {
  const mapPath = join(cwd, ".devorch", "project-map.md");
  mkdirSync(dirname(mapPath), { recursive: true });
  writeFileSync(mapPath, finalOutput, "utf-8");
}
