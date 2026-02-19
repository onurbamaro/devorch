/**
 * init-phase.ts — Compound phase init: plan context + conventions + state + filtered explore-cache + waves/tasks.
 * Usage: bun ~/.claude/devorch-scripts/init-phase.ts --plan <path> --phase <N> [--cache-root <path>]
 * Output: JSON with phaseNumber, phaseName, totalPhases, planTitle, waves, tasks, and content (or contentFile if >25000 chars).
 * Compound init: returns phase context, conventions, state, filtered explore-cache, and structured waves/tasks as JSON.
 * --cache-root: when provided, reads explore-cache from <cache-root>/.devorch/explore-cache.md instead of from the plan's directory.
 */
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { extractTagContent, parsePhaseBounds, readPlan, extractPlanTitle } from "./lib/plan-parser";
import { safeReadFile } from "./lib/fs-utils";

const CONTENT_THRESHOLD = 25000;
const CONTEXT_FILE = ".devorch/.phase-context.md";

interface WaveInfo {
  wave: number;
  taskIds: string[];
  type: "parallel" | "sequential" | "validation";
}

interface TaskInfo {
  id: string;
  assignedTo: string;
  title: string;
  content: string;
}

const args = parseArgs<{ plan: string; phase: number; "cache-root": string }>([
  { name: "plan", type: "string", required: true },
  { name: "phase", type: "number", required: true },
  { name: "cache-root", type: "string" },
]);

const planPath = args.plan;
const phaseNum = args.phase;
const cacheRoot = args["cache-root"];

const content = readPlan(planPath);
const phases = parsePhaseBounds(content);

if (phases.length === 0) {
  console.error("No phases found in plan.");
  process.exit(1);
}

const targetPhase = phases.find((p) => p.phase === phaseNum);
if (!targetPhase) {
  console.error(`Phase ${phaseNum} not found. Available: ${phases.map((p) => p.phase).join(", ")}`);
  process.exit(1);
}

const planTitle = extractPlanTitle(content);

// --- Extract plan-level fields ---
const objective = extractTagContent(content, "objective") || "";
const decisions = extractTagContent(content, "decisions") || "";
const solutionApproach = extractTagContent(content, "solution-approach") || "";

// --- Extract phase content ---
const phaseContent = targetPhase.content;

// --- Extract handoff from N-1 ---
let handoff = "";
if (phaseNum > 1) {
  const prevPhase = phases.find((p) => p.phase === phaseNum - 1);
  if (prevPhase) {
    handoff = extractTagContent(prevPhase.content, "handoff") || "";
  }
}

// --- Resolve plan directory for relative file paths ---
const planDir = dirname(resolve(planPath));
const projectRoot = resolve(planDir, "../..");

// --- Read optional files ---
const conventions = safeReadFile(resolve(projectRoot, ".devorch/CONVENTIONS.md"));
const state = safeReadFile(resolve(projectRoot, ".devorch/state.md"));
const cacheSource = cacheRoot ? resolve(cacheRoot, ".devorch/explore-cache.md") : resolve(projectRoot, ".devorch/explore-cache.md");
const cacheRaw = safeReadFile(cacheSource);

// --- Filter explore-cache by phase file paths ---
function filterCache(cache: string, phaseText: string): string {
  if (!cache) return "";

  const tasksContent = extractTagContent(phaseText, "tasks") || "";
  const fileRefs = new Set<string>();
  const filePatterns = [...tasksContent.matchAll(/`([^`]*(?:\/[^`]+|\.\w{1,5}))`/g)];
  for (const match of filePatterns) {
    const ref = match[1];
    if (/\.\w{1,5}$/.test(ref) || ref.includes("/")) {
      fileRefs.add(ref);
    }
  }

  if (fileRefs.size === 0) return cache;

  const sections = cache.split(/(?=^## )/m);
  const matched: string[] = [];

  for (const section of sections) {
    if (!section.startsWith("## ")) {
      matched.push(section);
      continue;
    }
    let sectionMatches = false;
    for (const ref of fileRefs) {
      if (section.includes(ref)) {
        sectionMatches = true;
        break;
      }
    }
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

// --- Parse waves from <execution> block ---
function parseWaves(phaseText: string): WaveInfo[] {
  const executionContent = extractTagContent(phaseText, "execution");
  if (!executionContent) return [];

  const waves: WaveInfo[] = [];
  const waveRegex = /\*\*Wave\s+(\d+)\*\*\s*(?:\(([^)]*)\))?\s*:\s*(.+)/gi;
  let waveMatch: RegExpExecArray | null;

  while ((waveMatch = waveRegex.exec(executionContent)) !== null) {
    const waveNum = parseInt(waveMatch[1], 10);
    const annotation = (waveMatch[2] || "").trim().toLowerCase();
    const taskIdStr = waveMatch[3];

    let type: "parallel" | "sequential" | "validation" = "parallel";
    if (annotation === "validation") {
      type = "validation";
    } else if (annotation === "sequential" || annotation.startsWith("after wave")) {
      type = "sequential";
    }

    const taskIds = taskIdStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    waves.push({ wave: waveNum, taskIds, type });
  }

  return waves;
}

// --- Parse tasks from <tasks> block ---
function parseTasks(phaseText: string): Record<string, TaskInfo> {
  const tasksContent = extractTagContent(phaseText, "tasks") || "";
  const tasks: Record<string, TaskInfo> = {};

  const taskHeaderRegex = /^####\s+\d+\.\s+/m;
  const taskSections = tasksContent.split(taskHeaderRegex);
  const taskHeaders = [...tasksContent.matchAll(/^####\s+\d+\.\s+(.+)$/gm)];

  for (let i = 0; i < taskHeaders.length; i++) {
    const title = taskHeaders[i][1].trim();
    const sectionContent = taskSections[i + 1] || "";

    const idMatch = sectionContent.match(/\*\*ID\*\*:\s*(\S+)/i);
    const id = idMatch ? idMatch[1] : "";

    const assignedMatch = sectionContent.match(/\*\*Assigned To\*\*:\s*(\S+)/i);
    const assignedTo = assignedMatch ? assignedMatch[1] : "";

    const fullContent = `#### ${taskHeaders[i][0].match(/\d+/)?.[0] || i + 1}. ${title}\n${sectionContent.trimEnd()}`;

    if (id) {
      tasks[id] = { id, assignedTo, title, content: fullContent };
    }
  }

  return tasks;
}

const waves = parseWaves(phaseContent);
const tasks = parseTasks(phaseContent);

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
  waves: WaveInfo[];
  tasks: Record<string, TaskInfo>;
  content?: string;
  contentFile?: string;
} = {
  phaseNumber: phaseNum,
  phaseName: targetPhase.name,
  totalPhases: phases.length,
  planTitle,
  waves,
  tasks,
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
