import { existsSync, rmSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_HOME = join(homedir(), ".claude");

const removals: { path: string; label: string; mode: "dir" | "glob" }[] = [
  {
    path: join(CLAUDE_HOME, "commands", "devorch"),
    label: "commands/devorch",
    mode: "dir",
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
];

console.log("devorch uninstall\n");

for (const { path, label, mode } of removals) {
  if (!existsSync(path)) {
    console.log(`  SKIP ${label} — not found`);
    continue;
  }

  if (mode === "dir") {
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

console.log("\ndevorch uninstalled.");
