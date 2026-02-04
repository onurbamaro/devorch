import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from "fs";
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
  {
    src: join(ROOT, "hooks"),
    dest: join(CLAUDE_HOME, "hooks"),
    label: "hooks",
  },
];

console.log("devorch install\n");

let totalFiles = 0;

for (const { src, dest, label } of targets) {
  if (!existsSync(src)) {
    console.log(`  SKIP ${label} — source not found: ${src}`);
    continue;
  }

  mkdirSync(dest, { recursive: true });

  const files = readdirSync(src);
  let count = 0;

  const claudeHomeFwd = CLAUDE_HOME.replaceAll("\\", "/");

  for (const file of files) {
    const srcFile = join(src, file);
    const destFile = join(dest, file);

    if (file.endsWith(".md")) {
      // Template substitution: resolve $CLAUDE_HOME to actual path
      const content = readFileSync(srcFile, "utf-8");
      const processed = content.replaceAll("$CLAUDE_HOME", claudeHomeFwd);
      writeFileSync(destFile, processed);
    } else {
      cpSync(srcFile, destFile, { force: true });
    }
    count++;
  }

  console.log(`  ${label}: ${count} files -> ${dest}`);
  totalFiles += count;
}

// Configure statusline in settings.json
const settingsPath = join(CLAUDE_HOME, "settings.json");
let settings: Record<string, any> = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (e) {
    // start fresh if corrupted
  }
}

const hookPath = join(CLAUDE_HOME, "hooks", "devorch-statusline.cjs");
const statuslineCmd = `node ${hookPath}`;
const isDevorch = settings.statusLine?.command?.includes("devorch-statusline");

if (!settings.statusLine) {
  settings.statusLine = { type: "command", command: statuslineCmd };
  console.log("\n  statusline: configured");
} else if (isDevorch) {
  settings.statusLine.command = statuslineCmd;
  console.log("\n  statusline: updated");
} else {
  console.log(`\n  statusline: skipped (already configured by another tool)`);
  console.log(`    current: ${settings.statusLine.command || "(custom)"}`);
  console.log(`    to use devorch's, run: devorch install --force-statusline`);
}

if (process.argv.includes("--force-statusline")) {
  settings.statusLine = { type: "command", command: statuslineCmd };
  console.log("  statusline: forced install");
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

console.log(`\nInstalled ${totalFiles} files.`);
console.log("Restart Claude Code for the statusline to take effect.");
console.log("Run /devorch:map-codebase in any project to get started.");
