import { existsSync, mkdirSync, cpSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const ROOT = resolve(import.meta.dirname);
const CLAUDE_HOME = join(homedir(), ".claude");

const targets = [
  {
    src: join(ROOT, "commands"),
    dest: join(CLAUDE_HOME, "commands", "devorch"),
    label: "commands",
  },
  {
    src: join(ROOT, "agents"),
    dest: join(CLAUDE_HOME, "agents"),
    label: "agents",
  },
  {
    src: join(ROOT, "scripts"),
    dest: join(CLAUDE_HOME, "devorch-scripts"),
    label: "scripts",
  },
];

console.log("devorch install\n");

let totalFiles = 0;

for (const { src, dest, label, prefix } of targets) {
  if (!existsSync(src)) {
    console.log(`  SKIP ${label} — source not found: ${src}`);
    continue;
  }

  mkdirSync(dest, { recursive: true });

  const files = readdirSync(src);
  let count = 0;

  for (const file of files) {
    const srcFile = join(src, file);
    const destFile = prefix
      ? join(dest, `${prefix}${file}`)
      : join(dest, file);
    cpSync(srcFile, destFile, { force: true });
    count++;
  }

  console.log(`  ${label}: ${count} files -> ${dest}`);
  totalFiles += count;
}

console.log(`\nInstalled ${totalFiles} files.`);
console.log("Run /devorch:map-codebase in any project to get started.");
