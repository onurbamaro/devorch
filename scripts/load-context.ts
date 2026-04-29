/**
 * load-context.ts — Loads optional devorch context for Stage 1.
 * Always exit 0; missing files return empty strings. Resolves profile precedence
 * (per-project → user-home → defaults) so the orchestrator gets a single source.
 *
 * Usage: bun ~/.claude/devorch-scripts/load-context.ts [project-dir]
 * Output: JSON to stdout
 */
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const cwd = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

function safeRead(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf-8") : "";
  } catch {
    return "";
  }
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

if (projectProfile) {
  profileRaw = projectProfile;
  profileSource = "project";
} else if (userProfile) {
  profileRaw = userProfile;
  profileSource = "user-home";
} else {
  profileRaw = DEFAULT_PROFILE;
  profileSource = "default";
}

const silencedStandards = safeRead(join(cwd, ".devorch", "standards-silenced.md"));

console.log(JSON.stringify({
  gotchas,
  gotchasLegacy,
  profile: {
    raw: profileRaw,
    source: profileSource,
  },
  silencedStandards,
  warnings: [],
}));
