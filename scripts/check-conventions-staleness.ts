/**
 * check-conventions-staleness.ts — Hash-based freshness check for CONVENTIONS.md.
 * Compares SHA-256 hashes of package.json deps and sampled source files.
 * Usage: bun scripts/check-conventions-staleness.ts [project-dir] [--update]
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from "fs";
import { join, extname } from "path";
import { parseArgs } from "./lib/args";

// --- CLI args ---
interface Args {
  update: boolean;
}
const args = parseArgs<Args>([{ name: "update", type: "boolean" }]);

// Positional arg (shared lib doesn't handle positional args)
const cwd = process.argv.slice(2).find((a) => !a.startsWith("--")) || process.cwd();

// --- Constants (must match map-conventions.ts exactly) ---
const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go",
  ".java", ".kt", ".rb", ".ex", ".exs", ".vue", ".svelte",
]);

const SAMPLE_DIRS = ["src", "lib", "app", "components", "pages", "routes", "server", "api", "utils", "hooks", "services"];

const IGNORE = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".venv", "venv", "target", "vendor", ".svelte-kit", ".turbo",
]);

const HASH_FILE = join(cwd, ".devorch", "conventions-hash.json");
const CONVENTIONS_FILE = join(cwd, ".devorch", "CONVENTIONS.md");

// --- Helper: collect source files (identical logic to map-conventions.ts) ---
function collectFiles(dir: string, maxPerDir: number): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;

  try {
    const entries = readdirSync(dir).filter((e) => !IGNORE.has(e) && !e.startsWith("."));
    let count = 0;

    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isFile()) {
          if (CODE_EXTS.has(extname(entry))) {
            result.push(full);
            count++;
            if (count >= maxPerDir) break;
          }
        } else if (stat.isDirectory() && result.length < maxPerDir * 3) {
          result.push(...collectFiles(full, 2));
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }

  return result;
}

// --- Compute current hashes ---
function computeDepsHash(): string | null {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    const deps = {
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
    };
    return createHash("sha256").update(JSON.stringify(deps)).digest("hex");
  } catch {
    return null;
  }
}

function computeSourceHash(): string {
  const allSamples: string[] = [];

  for (const d of SAMPLE_DIRS) {
    const dir = join(cwd, d);
    if (existsSync(dir)) {
      allSamples.push(...collectFiles(dir, 5));
    }
  }

  // Fallback: root files
  if (allSamples.length === 0) {
    allSamples.push(...collectFiles(cwd, 10));
  }

  const samples = allSamples.slice(0, 12);

  const hasher = createHash("sha256");
  for (const file of samples) {
    try {
      const content = readFileSync(file, "utf-8");
      const first50 = content.split("\n").slice(0, 50).join("\n");
      hasher.update(file + "\n" + first50 + "\n");
    } catch {
      continue;
    }
  }

  return hasher.digest("hex");
}

// --- Read stored hashes ---
interface StoredHashes {
  depsHash: string;
  sourceHash: string;
  checkedAt: string;
}

function readStoredHashes(): StoredHashes | null {
  if (!existsSync(HASH_FILE)) return null;

  try {
    const raw = readFileSync(HASH_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.depsHash === "string" &&
      typeof parsed.sourceHash === "string" &&
      typeof parsed.checkedAt === "string"
    ) {
      return parsed as StoredHashes;
    }
    // Missing fields — treat as corrupted
    return null;
  } catch {
    // JSON parse error or read error — treat as corrupted
    return null;
  }
}

// --- Main logic ---
const pkgPath = join(cwd, "package.json");
if (!existsSync(pkgPath)) {
  console.error(`check-conventions-staleness: package.json not found in ${cwd}`);
  process.exit(1);
}

const currentDepsHash = computeDepsHash();
if (!currentDepsHash) {
  console.error("check-conventions-staleness: failed to parse package.json");
  process.exit(1);
}
const currentSourceHash = computeSourceHash();

const stored = readStoredHashes();

// Determine staleness
type StaleReason = "fresh" | "no-hash-file" | "deps-changed" | "source-changed" | "conventions-missing";

let stale = false;
let reason: StaleReason = "fresh";

if (!existsSync(CONVENTIONS_FILE)) {
  stale = true;
  reason = "conventions-missing";
} else if (stored === null) {
  stale = true;
  reason = "no-hash-file";
} else if (stored.depsHash !== currentDepsHash) {
  stale = true;
  reason = "deps-changed";
} else if (stored.sourceHash !== currentSourceHash) {
  stale = true;
  reason = "source-changed";
}

// Write updated hashes if --update flag is set
if (args.update) {
  const devorchDir = join(cwd, ".devorch");
  if (!existsSync(devorchDir)) {
    try {
      mkdirSync(devorchDir, { recursive: true });
    } catch (err) {
      console.error(`check-conventions-staleness: failed to create .devorch/ directory: ${err}`);
      process.exit(1);
    }
  }

  const newHashes: StoredHashes = {
    depsHash: currentDepsHash,
    sourceHash: currentSourceHash,
    checkedAt: new Date().toISOString(),
  };

  try {
    writeFileSync(HASH_FILE, JSON.stringify(newHashes, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.error(`check-conventions-staleness: failed to write ${HASH_FILE}: ${err}`);
    process.exit(1);
  }
}

console.log(JSON.stringify({
  stale,
  reason,
  depsHash: currentDepsHash,
  sourceHash: currentSourceHash,
}));
