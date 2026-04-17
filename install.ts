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

  // Clean destination to remove stale files from previously deleted commands
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
  }
  mkdirSync(dest, { recursive: true });

  const claudeHomeFwd = CLAUDE_HOME.replaceAll("\\", "/");
  let count = 0;

  // For the commands target, `devorch.md` at the root of `commands/` is the
  // v3 unified entry and must be installed as a top-level slash command at
  // `~/.claude/commands/devorch.md` — not namespaced under `devorch/`.
  const isCommands = label === "commands";

  function copyDir(srcDir: string, destDir: string, atRoot = false) {
    mkdirSync(destDir, { recursive: true });
    const entries = readdirSync(srcDir);
    for (const entry of entries) {
      // Skip the top-level devorch.md inside commands/ — copied separately below.
      if (atRoot && isCommands && entry === "devorch.md") continue;

      const srcEntry = join(srcDir, entry);
      const destEntry = join(destDir, entry);
      if (statSync(srcEntry).isDirectory()) {
        copyDir(srcEntry, destEntry, false);
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

  copyDir(src, dest, true);

  // Install the v3 top-level /devorch command outside the namespaced folder.
  if (isCommands) {
    const topSrc = join(src, "devorch.md");
    if (existsSync(topSrc)) {
      const topDest = join(CLAUDE_HOME, "commands", "devorch.md");
      const content = readFileSync(topSrc, "utf-8");
      const processed = content.replaceAll("$CLAUDE_HOME", claudeHomeFwd);
      writeFileSync(topDest, processed);
      count++;
      console.log(`  commands/devorch.md -> ${topDest} (top-level /devorch)`);
    }
  }

  console.log(`  ${label}: ${count} files -> ${dest}`);
  totalFiles += count;
}

// Install script dependencies (ts-morph) in the scripts directory
const scriptsDest = join(CLAUDE_HOME, "devorch-scripts");
const pkgPath = join(ROOT, "package.json");
if (existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = pkg.dependencies || {};
    if (Object.keys(deps).length > 0) {
      const scriptsPkg = {
        name: "devorch-scripts",
        private: true,
        dependencies: deps,
      };
      writeFileSync(join(scriptsDest, "package.json"), JSON.stringify(scriptsPkg, null, 2) + "\n");
      const install = Bun.spawnSync(["bun", "install"], { cwd: scriptsDest, stderr: "pipe" });
      if (install.exitCode === 0) {
        console.log(`\n  deps: installed in ${scriptsDest}`);
      } else {
        console.log(`\n  deps: install failed (exit ${install.exitCode})`);
      }
    }
  } catch {
    console.log("\n  deps: skipped (could not parse package.json)");
  }
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
const statuslineCmd = `node "${hookPath}"`;
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

// Register PostCompact hook for devorch state refresh
const postCompactHookPath = join(CLAUDE_HOME, "hooks", "post-compact-state-refresh.ts");
const postCompactCmd = `bun "${postCompactHookPath}"`;

if (!settings.hooks) {
  settings.hooks = {};
}
if (!settings.hooks.PostCompact) {
  settings.hooks.PostCompact = [];
}

// Remove malformed entries (missing hooks array - from older install versions)
settings.hooks.PostCompact = settings.hooks.PostCompact.filter(
  (h: any) => Array.isArray(h.hooks)
);

// Check if devorch PostCompact hook is already registered
const hasPostCompact = settings.hooks.PostCompact.some(
  (h: any) => h.hooks?.some((hook: any) => hook.command?.includes("post-compact-state-refresh"))
);

if (!hasPostCompact) {
  settings.hooks.PostCompact.push({
    matcher: "",
    hooks: [{ type: "command", command: postCompactCmd }],
  });
  console.log("\n  PostCompact hook: configured");
} else {
  // Update existing entry
  const idx = settings.hooks.PostCompact.findIndex(
    (h: any) => h.hooks?.some((hook: any) => hook.command?.includes("post-compact-state-refresh"))
  );
  if (idx >= 0) {
    const hookIdx = settings.hooks.PostCompact[idx].hooks.findIndex(
      (hook: any) => hook.command?.includes("post-compact-state-refresh")
    );
    if (hookIdx >= 0) {
      settings.hooks.PostCompact[idx].hooks[hookIdx].command = postCompactCmd;
    }
  }
  console.log("\n  PostCompact hook: updated");
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

console.log(`\nInstalled ${totalFiles} files.`);
console.log("Restart Claude Code for the statusline to take effect.");
console.log("Run /devorch in any project to get started.");
