/**
 * fs-utils.ts — Shared file system utilities and sampling constants.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

// --- Shared sampling constants (used by map-conventions.ts and check-conventions-staleness.ts) ---

export const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go",
  ".java", ".kt", ".rb", ".ex", ".exs", ".vue", ".svelte",
]);

export const SAMPLE_DIRS = [
  "src", "lib", "app", "components", "pages", "routes",
  "server", "api", "utils", "hooks", "services",
];

export const IGNORE = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".venv", "venv", "target", "vendor", ".svelte-kit", ".turbo",
]);

export const SAMPLE_CAP = 30;
export const MAX_PER_DIR = 8;
export const LINES_TO_READ = 80;

// --- Shared utilities ---

export function safeReadFile(filePath: string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8");
    }
  } catch {
    // ignore — optional file
  }
  return "";
}

export function collectFiles(
  dir: string,
  maxPerDir: number,
  opts?: { trackTests?: boolean; testCount?: { value: number } }
): string[] {
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
          if (opts?.trackTests && (/\.test\./.test(entry) || /\.spec\./.test(entry))) {
            if (opts.testCount) opts.testCount.value++;
          }
          if (CODE_EXTS.has(extname(entry))) {
            result.push(full);
            count++;
            if (count >= maxPerDir) break;
          }
        } else if (stat.isDirectory() && result.length < maxPerDir * 3) {
          result.push(...collectFiles(full, 2, opts));
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

export function collectSampleFiles(
  cwd: string,
  opts?: { trackTests?: boolean; testCount?: { value: number } }
): string[] {
  const allSamples: string[] = [];

  for (const d of SAMPLE_DIRS) {
    const dir = join(cwd, d);
    if (existsSync(dir)) {
      allSamples.push(...collectFiles(dir, MAX_PER_DIR, opts));
    }
  }

  // Fallback: root files
  if (allSamples.length === 0) {
    allSamples.push(...collectFiles(cwd, 10, opts));
  }

  return allSamples.slice(0, SAMPLE_CAP);
}
