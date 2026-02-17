/**
 * manage-cache.ts — Invalidates and trims the explore-cache based on git changes.
 * Usage: bun ~/.claude/devorch-scripts/manage-cache.ts --action <invalidate|trim|invalidate,trim> [--max-lines 3000]
 * Output: JSON {"action", "sectionsRemoved", "sectionsRemaining", "linesAfter"}
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

function parseArgs(): { action: string; maxLines: number } {
  const args = process.argv.slice(2);
  let action = "";
  let maxLines = 3000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--action" && args[i + 1]) {
      action = args[++i];
    } else if (args[i] === "--max-lines" && args[i + 1]) {
      maxLines = parseInt(args[++i], 10);
    }
  }

  if (!action) {
    console.error("Usage: manage-cache.ts --action <invalidate|trim|invalidate,trim> [--max-lines 3000]");
    process.exit(1);
  }

  return { action, maxLines };
}

interface CacheSection {
  header: string;
  content: string;
}

function parseCacheSections(text: string): { preamble: string; sections: CacheSection[] } {
  const lines = text.split("\n");
  let preamble = "";
  const sections: CacheSection[] = [];
  let currentHeader = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeader) {
        sections.push({ header: currentHeader, content: currentLines.join("\n") });
      }
      currentHeader = line;
      currentLines = [];
    } else if (!currentHeader) {
      preamble += (preamble ? "\n" : "") + line;
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeader) {
    sections.push({ header: currentHeader, content: currentLines.join("\n") });
  }

  return { preamble, sections };
}

function rebuildCache(preamble: string, sections: CacheSection[]): string {
  let result = preamble;
  for (const section of sections) {
    result += "\n" + section.header + "\n" + section.content;
  }
  return result;
}

function getChangedFiles(): string[] {
  try {
    const proc = Bun.spawnSync(["git", "diff", "--name-only", "HEAD~1..HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) return [];
    const output = proc.stdout.toString("utf-8").trim();
    if (!output) return [];
    return output.split("\n").map((f) => f.trim().replaceAll("\\", "/")).filter(Boolean);
  } catch {
    return [];
  }
}

const { action, maxLines } = parseArgs();
const actions = action.split(",").map((a) => a.trim().toLowerCase());
const cachePath = resolve(process.cwd(), ".devorch/explore-cache.md");

if (!existsSync(cachePath)) {
  console.log(JSON.stringify({ action, sectionsRemoved: 0, sectionsRemaining: 0, linesAfter: 0 }));
  process.exit(0);
}

let cacheContent = readFileSync(cachePath, "utf-8");
let { preamble, sections } = parseCacheSections(cacheContent);
let totalRemoved = 0;

// --- Invalidate ---
if (actions.includes("invalidate")) {
  const changedFiles = getChangedFiles();
  if (changedFiles.length > 0) {
    const beforeCount = sections.length;
    sections = sections.filter((section) => {
      const sectionText = (section.header + "\n" + section.content).replaceAll("\\", "/");
      const hasOverlap = changedFiles.some((f) => sectionText.includes(f));
      return !hasOverlap;
    });
    totalRemoved += beforeCount - sections.length;
  }
}

// --- Trim ---
if (actions.includes("trim")) {
  let rebuilt = rebuildCache(preamble, sections);
  let lineCount = rebuilt.split("\n").length;

  while (lineCount > maxLines && sections.length > 0) {
    sections.shift();
    totalRemoved++;
    rebuilt = rebuildCache(preamble, sections);
    lineCount = rebuilt.split("\n").length;
  }
}

// --- Write ---
const finalContent = rebuildCache(preamble, sections);
writeFileSync(cachePath, finalContent, "utf-8");

const linesAfter = finalContent.split("\n").length;

console.log(JSON.stringify({
  action,
  sectionsRemoved: totalRemoved,
  sectionsRemaining: sections.length,
  linesAfter,
}));
