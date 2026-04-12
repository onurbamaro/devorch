/**
 * check-conventions-staleness.ts — Hash-based freshness check for CONVENTIONS.md.
 * Compares SHA-256 hashes of package.json deps and sampled source files.
 * Usage: bun scripts/check-conventions-staleness.ts [project-dir] [--update]
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { parseArgs } from "./lib/args";
import { collectSampleFiles, LINES_TO_READ } from "./lib/fs-utils";

// --- CLI args ---
interface Args {
  update: boolean;
}
const args = parseArgs<Args>([{ name: "update", type: "boolean" }]);

// Positional arg (shared lib doesn't handle positional args)
const cwd = process.argv.slice(2).find((a) => !a.startsWith("--")) || process.cwd();

const HASH_FILE = join(cwd, ".devorch", "conventions-hash.json");
const CONVENTIONS_FILE = join(cwd, ".devorch", "CONVENTIONS.md");

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
  const samples = collectSampleFiles(cwd);

  const hasher = createHash("sha256");
  for (const file of samples) {
    try {
      const content = readFileSync(file, "utf-8");
      const firstN = content.split("\n").slice(0, LINES_TO_READ).join("\n");
      hasher.update(file + "\n" + firstN + "\n");
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
    return null;
  } catch {
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
