/**
 * init-phase.ts — Compound phase init: plan context + conventions + state + filtered explore-cache.
 * Usage: bun ~/.claude/devorch-scripts/init-phase.ts --plan <path> --phase <N>
 * Output: JSON with phaseNumber, phaseName, totalPhases, planTitle, and content (or contentFile if >25000 chars).
 * Compound init: returns phase context, conventions, state, and filtered explore-cache as structured JSON.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

const CONTENT_THRESHOLD = 25000;
const CONTEXT_FILE = ".devorch/.phase-context.md";

function parseArgs(): { plan: string; phase: number } {
  const args = process.argv.slice(2);
  let plan = "";
  let phase = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    } else if (args[i] === "--phase" && args[i + 1]) {
      phase = parseInt(args[++i], 10);
    }
  }

  if (!plan || !phase) {
    console.error("Usage: init-phase.ts --plan <path> --phase <N>");
    process.exit(1);
  }

  return { plan, phase };
}

function extractTagContent(text: string, tagName: string): string {
  // Match tags at line start (after optional whitespace) to skip inline backtick references
  const match = text.match(new RegExp(`^\\s*<${tagName}>([\\s\\S]*?)^\\s*<\\/${tagName}>`, "im"));
  return match ? match[1].trim() : "";
}

function safeReadFile(filePath: string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8");
    }
  } catch {
    // ignore — optional file
  }
  return "";
}

interface PhaseBounds {
  num: number;
  name: string;
  start: number;
  end: number;
}

const { plan: planPath, phase: phaseNum } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

const lines = content.split("\n");

// --- Single pass: find all phase boundaries ---
const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/i;
const phaseCloseRegex = /<\/phase(\d+)>/i;

const phases: PhaseBounds[] = [];

for (let i = 0; i < lines.length; i++) {
  const openMatch = lines[i].match(phaseOpenRegex);
  if (openMatch) {
    phases.push({
      num: parseInt(openMatch[1], 10),
      name: openMatch[2],
      start: i,
      end: lines.length,
    });
  }
  const closeMatch = lines[i].match(phaseCloseRegex);
  if (closeMatch) {
    const closeNum = parseInt(closeMatch[1], 10);
    const phase = phases.find((p) => p.num === closeNum);
    if (phase) {
      phase.end = i + 1;
    }
  }
}

if (phases.length === 0) {
  console.error("No phases found in plan.");
  process.exit(1);
}

// --- Find target phase ---
const targetPhase = phases.find((p) => p.num === phaseNum);
if (!targetPhase) {
  console.error(`Phase ${phaseNum} not found. Available: ${phases.map((p) => p.num).join(", ")}`);
  process.exit(1);
}

// --- Extract plan title ---
const titleMatch = content.match(/^#\s+Plan:\s+(.+)$/m);
const planTitle = titleMatch ? titleMatch[1].trim() : "Untitled Plan";

// --- Extract plan-level fields ---
const objective = extractTagContent(content, "objective");
const decisions = extractTagContent(content, "decisions");
const solutionApproach = extractTagContent(content, "solution-approach");

// --- Extract phase content ---
const phaseContent = lines.slice(targetPhase.start, targetPhase.end).join("\n");

// --- Extract handoff from N-1 ---
let handoff = "";
if (phaseNum > 1) {
  const prevPhase = phases.find((p) => p.num === phaseNum - 1);
  if (prevPhase) {
    const prevContent = lines.slice(prevPhase.start, prevPhase.end).join("\n");
    handoff = extractTagContent(prevContent, "handoff");
  }
}

// --- Resolve plan directory for relative file paths ---
const planDir = dirname(resolve(planPath));
const projectRoot = resolve(planDir, "../..");

// --- Read optional files ---
const conventions = safeReadFile(resolve(projectRoot, ".devorch/CONVENTIONS.md"));
const state = safeReadFile(resolve(projectRoot, ".devorch/state.md"));
const cacheRaw = safeReadFile(resolve(projectRoot, ".devorch/explore-cache.md"));

// --- Filter explore-cache by phase file paths ---
function filterCache(cache: string, phaseText: string): string {
  if (!cache) return "";

  // Extract file paths mentioned in the phase tasks
  const tasksContent = extractTagContent(phaseText, "tasks");
  const fileRefs = new Set<string>();
  const filePatterns = [...tasksContent.matchAll(/`([^`]*(?:\/[^`]+|\.\w{1,5}))`/g)];
  for (const match of filePatterns) {
    const ref = match[1];
    if (/\.\w{1,5}$/.test(ref) || ref.includes("/")) {
      fileRefs.add(ref);
    }
  }

  if (fileRefs.size === 0) return cache; // no file refs → include all cache

  // Split cache into sections by ## headers
  const sections = cache.split(/(?=^## )/m);
  const matched: string[] = [];

  for (const section of sections) {
    if (!section.startsWith("## ")) {
      // Header or preamble — always include
      matched.push(section);
      continue;
    }
    // Check if any file ref appears in this section
    let sectionMatches = false;
    for (const ref of fileRefs) {
      if (section.includes(ref)) {
        sectionMatches = true;
        break;
      }
    }
    // Also match directory prefixes (e.g., "scripts/" matches "scripts/init-phase.ts")
    if (!sectionMatches) {
      for (const ref of fileRefs) {
        const dir = ref.split("/")[0];
        if (dir && section.toLowerCase().includes(dir.toLowerCase())) {
          sectionMatches = true;
          break;
        }
      }
    }
    if (sectionMatches) {
      matched.push(section);
    }
  }

  return matched.join("").trim();
}

const filteredCache = filterCache(cacheRaw, phaseContent);

// --- Build output content ---
const parts: string[] = [];

parts.push(`# Phase ${phaseNum}: ${targetPhase.name}`);
parts.push("");

if (objective) {
  parts.push("## Objective");
  parts.push("");
  parts.push(objective);
  parts.push("");
}

if (decisions) {
  parts.push("## Decisions");
  parts.push("");
  parts.push(decisions);
  parts.push("");
}

if (solutionApproach) {
  parts.push("## Solution Approach");
  parts.push("");
  parts.push(solutionApproach);
  parts.push("");
}

parts.push("## Phase Content");
parts.push("");
parts.push(phaseContent);
parts.push("");

if (handoff) {
  parts.push("## Previous Handoff");
  parts.push("");
  parts.push(handoff);
  parts.push("");
}

if (conventions) {
  parts.push("## Conventions");
  parts.push("");
  parts.push(conventions);
  parts.push("");
}

if (state) {
  parts.push("## Current State");
  parts.push("");
  parts.push(state);
  parts.push("");
}

if (filteredCache) {
  parts.push("## Explore Cache (filtered)");
  parts.push("");
  parts.push(filteredCache);
  parts.push("");
}

const fullContent = parts.join("\n");

// --- Output ---
const result: {
  phaseNumber: number;
  phaseName: string;
  totalPhases: number;
  planTitle: string;
  content?: string;
  contentFile?: string;
} = {
  phaseNumber: phaseNum,
  phaseName: targetPhase.name,
  totalPhases: phases.length,
  planTitle,
};

if (fullContent.length > CONTENT_THRESHOLD) {
  const contextPath = resolve(projectRoot, CONTEXT_FILE);
  mkdirSync(dirname(contextPath), { recursive: true });
  writeFileSync(contextPath, fullContent, "utf-8");
  result.contentFile = CONTEXT_FILE;
} else {
  result.content = fullContent;
}

console.log(JSON.stringify(result, null, 2));
