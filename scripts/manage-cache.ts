/**
 * manage-cache.ts — Invalidates and trims the explore-cache based on git changes.
 * Usage: bun ~/.claude/devorch-scripts/manage-cache.ts --action <invalidate|trim|invalidate,trim> [--max-lines 3000] [--root <path>]
 * Output: JSON {"action", "sectionsRemoved", "sectionsRemaining", "linesAfter"}
 * --root: when provided, resolves cache path and runs git commands relative to <root> instead of process.cwd().
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "./lib/args";

interface CacheSection {
  header: string;
  content: string;
}

const args = parseArgs<{ action: string; "max-lines": number; root: string }>([
  { name: "action", type: "string", required: true },
  { name: "max-lines", type: "number" },
  { name: "root", type: "string" },
]);

const action = args.action;
const maxLines = args["max-lines"] || 3000;
const root = args.root;
const actions = action.split(",").map((a) => a.trim().toLowerCase());
const baseDir = root || process.cwd();
const cachePath = resolve(baseDir, ".devorch/explore-cache.md");

if (!existsSync(cachePath)) {
  console.log(JSON.stringify({ action, sectionsRemoved: 0, sectionsRemaining: 0, linesAfter: 0 }));
  process.exit(0);
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

function getChangedFiles(gitCwd?: string): string[] {
  try {
    const proc = Bun.spawnSync(["git", "diff", "--name-only", "HEAD~1..HEAD"], {
      cwd: gitCwd || undefined,
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

let cacheContent = readFileSync(cachePath, "utf-8");
let { preamble, sections } = parseCacheSections(cacheContent);
let totalRemoved = 0;

// --- Invalidate ---
if (actions.includes("invalidate")) {
  const changedFiles = getChangedFiles(root || undefined);
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
