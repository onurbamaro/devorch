import { existsSync, rmSync, readdirSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_HOME = join(homedir(), ".claude");

const removals: { path: string; label: string; mode: "dir" | "glob" | "file" }[] = [
  {
    path: join(CLAUDE_HOME, "commands", "devorch"),
    label: "commands/devorch",
    mode: "dir",
  },
  {
    path: join(CLAUDE_HOME, "commands", "devorch.md"),
    label: "commands/devorch.md",
    mode: "file",
  },
  {
    path: join(CLAUDE_HOME, "agents"),
    label: "agents/devorch-*",
    mode: "glob",
  },
  {
    path: join(CLAUDE_HOME, "devorch-scripts"),
    label: "devorch-scripts",
    mode: "dir",
  },
  {
    path: join(CLAUDE_HOME, "devorch-templates"),
    label: "devorch-templates",
    mode: "dir",
  },
];

console.log("devorch uninstall\n");

for (const { path, label, mode } of removals) {
  if (!existsSync(path)) {
    console.log(`  SKIP ${label} — not found`);
    continue;
  }

  if (mode === "file") {
    unlinkSync(path);
    console.log(`  REMOVED ${label}`);
  } else if (mode === "dir") {
    rmSync(path, { recursive: true, force: true });
    console.log(`  REMOVED ${label}`);
  } else if (mode === "glob") {
    const files = readdirSync(path).filter((f) => f.startsWith("devorch-"));
    for (const f of files) {
      unlinkSync(join(path, f));
    }
    console.log(`  REMOVED ${files.length} devorch-* files from ${label}`);
  }
}

// Remove devorch hook
const hookPath = join(CLAUDE_HOME, "hooks", "devorch-statusline.cjs");
if (existsSync(hookPath)) {
  unlinkSync(hookPath);
  console.log("  REMOVED hooks/devorch-statusline.cjs");
}

// Clean statusline from settings.json if it's ours
const settingsPath = join(CLAUDE_HOME, "settings.json");
if (existsSync(settingsPath)) {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (settings.statusLine?.command?.includes("devorch-statusline")) {
      delete settings.statusLine;
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      console.log("  REMOVED statusline from settings.json");
    }
  } catch (e) {
    // ignore parse errors
  }
}

console.log("\ndevorch uninstalled.");
