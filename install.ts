import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const ROOT = resolve(import.meta.dirname);
const CLAUDE_HOME = join(homedir(), ".claude");

const targets = [
  {
    src: join(ROOT, "commands"),
    dest: join(CLAUDE_HOME, "commands", "devorch"),
    label: "commands",
    exclude: ["devorch.md"],
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
    src: join(ROOT, "templates"),
    dest: join(CLAUDE_HOME, "devorch-templates"),
    label: "templates",
  },
  {
    src: join(ROOT, "hooks"),
    dest: join(CLAUDE_HOME, "hooks"),
    label: "hooks",
  },
];

console.log("devorch install\n");

let totalFiles = 0;

for (const { src, dest, label, exclude } of targets) {
  if (!existsSync(src)) {
    console.log(`  SKIP ${label} — source not found: ${src}`);
    continue;
  }

  // Clean destination to remove stale files from previously deleted commands
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
  }
  mkdirSync(dest, { recursive: true });

  const claudeHomeFwd = CLAUDE_HOME.replaceAll("\\", "/");
  const excludeSet = new Set(exclude ?? []);
  let count = 0;

  function copyDir(srcDir: string, destDir: string) {
    mkdirSync(destDir, { recursive: true });
    const entries = readdirSync(srcDir);
    for (const entry of entries) {
      if (srcDir === src && excludeSet.has(entry)) continue;
      const srcEntry = join(srcDir, entry);
      const destEntry = join(destDir, entry);
      if (statSync(srcEntry).isDirectory()) {
        copyDir(srcEntry, destEntry);
      } else if (entry.endsWith(".md")) {
        const content = readFileSync(srcEntry, "utf-8");
        const processed = content.replaceAll("$CLAUDE_HOME", claudeHomeFwd);
        writeFileSync(destEntry, processed);
        count++;
      } else {
        cpSync(srcEntry, destEntry, { force: true });
        count++;
      }
    }
  }

  copyDir(src, dest);

  console.log(`  ${label}: ${count} files -> ${dest}`);
  totalFiles += count;
}

// Copy commands/devorch.md to root level for /devorch skill name
const rootDevorchSrc = join(ROOT, "commands", "devorch.md");
if (existsSync(rootDevorchSrc)) {
  const claudeHomeFwd = CLAUDE_HOME.replaceAll("\\", "/");
  mkdirSync(join(CLAUDE_HOME, "commands"), { recursive: true });
  const content = readFileSync(rootDevorchSrc, "utf-8");
  const processed = content.replaceAll("$CLAUDE_HOME", claudeHomeFwd);
  writeFileSync(join(CLAUDE_HOME, "commands", "devorch.md"), processed);
  console.log(`  commands/devorch.md -> ${join(CLAUDE_HOME, "commands", "devorch.md")} (root level)`);
  totalFiles++;
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
console.log("Run /devorch in any project to get started.");
