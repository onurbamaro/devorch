/**
 * init-phase.ts — Compound phase init: plan context + conventions + state + filtered explore-cache + waves/tasks.
 * Usage: bun ~/.claude/devorch-scripts/init-phase.ts --plan <path> --phase <N> [--cache-root <path>] [--cache-name <name>]
 * Output: JSON with phaseNumber, phaseName, totalPhases, planTitle, waves, tasks, and content (or contentFile if >50000 chars).
 * Compound init: returns phase context, conventions, state, filtered explore-cache, and structured waves/tasks as JSON.
 * --cache-root: when provided, reads explore-cache from <cache-root>/.devorch/ instead of from the plan's directory.
 * --cache-name: when provided, reads explore-cache-<name>.md instead of explore-cache.md. Enables per-plan cache isolation.
 */
import { existsSync, writeFileSync, mkdirSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { extractTagContent, parsePhaseBounds, readPlan, extractPlanTitle, extractSecondaryRepos, extractPhaseSpec, filterSpecsByRefs, extractExploreQueries } from "./lib/plan-parser";
import { safeReadFile } from "./lib/fs-utils";

const CONTENT_THRESHOLD = 50000;
const CONTEXT_FILE = ".devorch/.phase-context.md";

interface WaveInfo {
  wave: number;
  taskIds: string[];
  type: "parallel" | "sequential";
}

interface TaskInfo {
  id: string;
  assignedTo: string;
  repo: string;
  title: string;
  content: string;
  model?: string;
  effort?: string;
}

interface SatelliteInfo {
  name: string;
  path: string;
  worktreePath: string;
}

const args = parseArgs<{ plan: string; phase: number; "cache-root": string; "cache-name": string }>([
  { name: "plan", type: "string", required: true },
  { name: "phase", type: "number", required: true },
  { name: "cache-root", type: "string" },
  { name: "cache-name", type: "string" },
]);

const planPath = args.plan;
const phaseNum = args.phase;
const cacheRoot = args["cache-root"];
const cacheName = args["cache-name"];

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

// --- Extract secondary repos (satellites) ---
const secondaryRepos = extractSecondaryRepos(content);

function deriveWorktreeName(title: string): string {
  return title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// Prefer actual worktree directory name over plan-title derivation.
// If projectRoot is inside a .worktrees/<name> folder, use <name> directly.
const worktreesDirMatch = projectRoot.match(/\.worktrees\/([^/]+)$/);
const worktreeName = worktreesDirMatch ? worktreesDirMatch[1] : deriveWorktreeName(planTitle);

// Resolve satellite paths from the main repo root (not the worktree).
// Secondary repo paths like "../salsago-core" are relative to the main repo.
const mainRoot = worktreesDirMatch ? resolve(projectRoot, "../..") : projectRoot;

const satellites: SatelliteInfo[] = secondaryRepos.map((repo) => {
  const resolvedPath = resolve(mainRoot, repo.path);
  const wtPath = resolve(resolvedPath, ".worktrees", worktreeName);
  return { name: repo.name, path: resolvedPath, worktreePath: wtPath };
});

// --- Read optional files ---
const conventions = safeReadFile(resolve(projectRoot, ".devorch/CONVENTIONS.md"));
const state = safeReadFile(resolve(projectRoot, ".devorch/state.md"));
const cacheRootDir = cacheRoot || projectRoot;
const cacheFileName = cacheName ? `explore-cache-${cacheName}.md` : "explore-cache.md";
const cacheSource = resolve(cacheRootDir, ".devorch", cacheFileName);
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

// --- Extract file refs from arbitrary text (for per-task filtering) ---
function extractFileRefs(text: string): Set<string> {
  const refs = new Set<string>();
  const patterns = [...text.matchAll(/`([^`]*(?:\/[^`]+|\.\w{1,5}))`/g)];
  for (const match of patterns) {
    const ref = match[1];
    if (/\.\w{1,5}$/.test(ref) || ref.includes("/")) {
      refs.add(ref);
    }
  }
  return refs;
}

// --- Filter cache sections by file refs (reusable for per-task) ---
function filterCacheByRefs(cache: string, fileRefs: Set<string>): string {
  if (!cache || fileRefs.size === 0) return cache;

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

// --- Extract file extensions from task content ---
function extractExtensions(text: string): Set<string> {
  const exts = new Set<string>();
  const refs = extractFileRefs(text);
  for (const ref of refs) {
    const extMatch = ref.match(/\.(\w{1,5})$/);
    if (extMatch) {
      exts.add(`.${extMatch[1]}`);
    }
  }
  return exts;
}

// --- Parse conventions into sections by ## headers ---
function parseConventionSections(conventionsText: string): Array<{ header: string; content: string }> {
  if (!conventionsText) return [];
  const sections: Array<{ header: string; content: string }> = [];
  const parts = conventionsText.split(/(?=^## )/m);
  for (const part of parts) {
    const headerMatch = part.match(/^## (.+)$/m);
    if (headerMatch) {
      sections.push({ header: headerMatch[1], content: part });
    } else if (part.trim()) {
      sections.push({ header: "", content: part });
    }
  }
  return sections;
}

// --- Extension-to-convention matching map ---
const EXT_KEYWORDS: Record<string, string[]> = {
  ".ts": ["typescript", "ts", "script", "naming", "export", "import", "style", "error", "pattern", "async", "bun", "testing", "gotcha", "workaround"],
  ".tsx": ["typescript", "ts", "tsx", "react", "component", "style", "jsx", "naming", "export", "import", "pattern"],
  ".js": ["javascript", "js", "script", "naming", "export", "import", "style", "pattern"],
  ".jsx": ["javascript", "js", "jsx", "react", "component", "style"],
  ".md": ["markdown", "md", "command", "documentation", "template"],
  ".css": ["style", "css"],
  ".scss": ["style", "scss", "css"],
  ".json": ["json", "package", "config"],
};

function filterConventionsForTask(conventionsText: string, taskExts: Set<string>): string[] {
  if (!conventionsText || taskExts.size === 0) return [];

  const sections = parseConventionSections(conventionsText);
  const matched: string[] = [];

  for (const section of sections) {
    if (!section.header) {
      continue;
    }
    const headerLower = section.header.toLowerCase();
    const contentLower = section.content.toLowerCase();

    let sectionMatches = false;
    for (const ext of taskExts) {
      const keywords = EXT_KEYWORDS[ext] || [ext.slice(1)];
      for (const kw of keywords) {
        if (headerLower.includes(kw) || contentLower.includes(kw)) {
          sectionMatches = true;
          break;
        }
      }
      if (sectionMatches) break;
    }
    if (sectionMatches) {
      matched.push(`## ${section.header}`);
    }
  }

  return matched;
}

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

    let type: "parallel" | "sequential" = "parallel";
    if (annotation === "sequential") {
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

    const repoMatch = sectionContent.match(/\*\*Repo\*\*:\s*(\S+)/i);
    const repo = repoMatch ? repoMatch[1] : "primary";

    const modelMatch = sectionContent.match(/\*\*Model\*\*:\s*(\S+)/i);
    const model = modelMatch ? modelMatch[1].toLowerCase() : undefined;

    const effortMatch = sectionContent.match(/\*\*Effort\*\*:\s*(\S+)/i);
    const effort = effortMatch ? effortMatch[1].toLowerCase() : undefined;

    const fullContent = `#### ${taskHeaders[i][0].match(/\d+/)?.[0] || i + 1}. ${title}\n${sectionContent.trimEnd()}`;

    if (id) {
      const task: TaskInfo = { id, assignedTo, repo, title, content: fullContent };
      if (model) task.model = model;
      if (effort) task.effort = effort;
      tasks[id] = task;
    }
  }

  return tasks;
}

const waves = parseWaves(phaseContent);
const tasks = parseTasks(phaseContent);

// --- Validate task repo fields against satellites ---
const repoRefs = new Map<string, string[]>();
for (const task of Object.values(tasks)) {
  if (task.repo && task.repo !== "primary") {
    if (!repoRefs.has(task.repo)) {
      repoRefs.set(task.repo, []);
    }
    repoRefs.get(task.repo)!.push(task.id);
  }
}

const satelliteNames = satellites.map((s) => s.name);
for (const [repoName, taskIds] of repoRefs) {
  if (!satelliteNames.includes(repoName)) {
    for (const taskId of taskIds) {
      console.error(
        `Task '${taskId}' references repo '${repoName}' but no satellite with that name exists. Available satellites: ${satelliteNames.join(", ") || "(none)"}`,
      );
    }
    process.exit(1);
  }
}

// --- Validate satellite worktree paths exist ---
for (const sat of satellites) {
  if (!existsSync(sat.worktreePath)) {
    console.error(
      `Satellite worktree for '${sat.name}' not found at ${sat.worktreePath}. Run setup-worktree.ts with --add-secondary to create it.`,
    );
    process.exit(1);
  }
}

// --- Run map-project.ts for project structure (cached) ---
const scriptDir = import.meta.dirname;
const projectMapPath = resolve(projectRoot, ".devorch/project-map.md");
let projectMap = "";

function isProjectMapFresh(): boolean {
  try {
    if (!existsSync(projectMapPath)) return false;
    const mtime = statSync(projectMapPath).mtimeMs;
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    return mtime > fiveMinAgo;
  } catch {
    return false;
  }
}

if (isProjectMapFresh()) {
  projectMap = safeReadFile(projectMapPath);
} else {
  try {
    const mapProc = Bun.spawnSync(
      ["bun", resolve(scriptDir, "map-project.ts"), projectRoot],
      { cwd: projectRoot, stderr: "pipe" }
    );
    if (mapProc.exitCode === 0) {
      projectMap = mapProc.stdout.toString().trim();
      try {
        mkdirSync(dirname(projectMapPath), { recursive: true });
        writeFileSync(projectMapPath, projectMap, "utf-8");
      } catch {
        // ignore — caching is best-effort
      }
    }
  } catch {
    // ignore — map is optional context
  }
}

// --- Run TLDR analysis for TS/TSX files in phase ---
interface TldrFileAnalysis {
  exports: Array<{ name: string; kind: string; signature?: string }>;
  imports: Array<{ from: string; names: string[] }>;
  functions: Array<{ name: string; params: string; returnType: string; isAsync: boolean; isExported: boolean }>;
  types: Array<{ name: string; kind: string; members?: string[] }>;
}

interface TldrResult {
  files: Record<string, TldrFileAnalysis>;
  warnings: string[];
  tokenEstimate: number;
}

function extractTsFiles(phaseText: string): string[] {
  const refs = extractFileRefs(phaseText);
  return [...refs].filter((r) => r.endsWith(".ts") || r.endsWith(".tsx"));
}

function formatTldrAnalysis(tldrResult: TldrResult): Record<string, string> {
  const formatted: Record<string, string> = {};

  for (const [filePath, analysis] of Object.entries(tldrResult.files)) {
    // Use relative-looking filename (last segment or relative path)
    const parts: string[] = [];
    const fileName = filePath.split("/").pop() || filePath;

    parts.push(`### ${fileName}`);

    if (analysis.exports.length > 0) {
      const exportStr = analysis.exports.map((e) => `${e.name} (${e.kind})`).join(", ");
      parts.push(`**Exports**: ${exportStr}`);
    }

    if (analysis.imports.length > 0) {
      const importStr = analysis.imports.map((i) => `${i.from} (${i.names.join(", ")})`).join(", ");
      parts.push(`**Imports**: ${importStr}`);
    }

    if (analysis.functions.length > 0) {
      const funcLines = analysis.functions.map((f) => {
        let line = `${f.name}(${f.params}): ${f.returnType}`;
        if (f.isAsync) line += " [async]";
        if (f.isExported) line += " [exported]";
        return line;
      });
      parts.push(`**Functions**: ${funcLines.join(", ")}`);
    }

    if (analysis.types.length > 0) {
      const typeStr = analysis.types.map((t) => `${t.name} (${t.kind})`).join(", ");
      parts.push(`**Types**: ${typeStr}`);
    }

    formatted[filePath] = parts.join("\n");
  }

  return formatted;
}

const phaseTsFiles = extractTsFiles(phaseContent);
let tldrByFile: Record<string, string> = {};

if (phaseTsFiles.length > 0) {
  try {
    const tldrProc = Bun.spawnSync(
      ["bun", resolve(scriptDir, "tldr-analyze.ts"), "--files", phaseTsFiles.join(","), "--root", projectRoot],
      { cwd: projectRoot, stderr: "pipe" }
    );
    if (tldrProc.exitCode === 0) {
      const tldrResult: TldrResult = JSON.parse(tldrProc.stdout.toString().trim());
      tldrByFile = formatTldrAnalysis(tldrResult);
    } else {
      console.error(`[init-phase] TLDR analysis failed (exit ${tldrProc.exitCode}) — skipping code structure context`);
    }
  } catch (e) {
    console.error(`[init-phase] TLDR analysis error: ${e instanceof Error ? e.message : String(e)} — skipping code structure context`);
  }
}

// --- Extract explore queries from phase content ---
const exploreQueries = extractExploreQueries(phaseContent);

// --- Extract phase-level specs ---
const phaseSpecContent = extractPhaseSpec(phaseContent) || "";

// --- Build per-task filtered context ---
const conventionSectionsByTask: Record<string, string[]> = {};
const cacheByTask: Record<string, string> = {};
const specsByTask: Record<string, string> = {};
const codeStructureByTask: Record<string, string> = {};

for (const [taskId, task] of Object.entries(tasks)) {
  const taskExts = extractExtensions(task.content);
  conventionSectionsByTask[taskId] = filterConventionsForTask(conventions, taskExts);

  const taskRefs = extractFileRefs(task.content);
  cacheByTask[taskId] = filterCacheByRefs(cacheRaw, taskRefs);

  // Extract **Spec refs** from task content; if present, filter specs; otherwise include full spec section
  const specRefsMatch = task.content.match(/\*\*Spec refs\*\*:\s*(.+)/);
  if (specRefsMatch && phaseSpecContent) {
    const refs = specRefsMatch[1].split(",").map((r) => r.trim()).filter(Boolean);
    specsByTask[taskId] = filterSpecsByRefs(phaseSpecContent, refs);
  } else {
    specsByTask[taskId] = phaseSpecContent;
  }

  // Filter TLDR by file refs — match task file paths against TLDR file paths
  if (Object.keys(tldrByFile).length > 0) {
    const matchedSections: string[] = [];
    for (const [tldrPath, tldrMarkdown] of Object.entries(tldrByFile)) {
      for (const ref of taskRefs) {
        if (tldrPath.includes(ref) || tldrPath.endsWith(ref)) {
          matchedSections.push(tldrMarkdown);
          break;
        }
      }
    }
    codeStructureByTask[taskId] = matchedSections.join("\n\n");
  }
}

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

if (phaseSpecContent) {
  parts.push("## Spec Contracts");
  parts.push("");
  parts.push(phaseSpecContent);
  parts.push("");
}

if (state) {
  parts.push("## Current State");
  parts.push("");
  parts.push(state);
  parts.push("");
}

if (projectMap) {
  parts.push("## Project Structure");
  parts.push("> Fresh snapshot — generated at phase init. Trust this as the current project layout.");
  parts.push("");
  parts.push(projectMap);
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
  satellites: SatelliteInfo[];
  waves: WaveInfo[];
  tasks: Record<string, TaskInfo>;
  conventions?: string;
  conventionSectionsByTask?: Record<string, string[]>;
  cacheByTask: Record<string, string>;
  /** Per-task filtered spec contracts. Keys are task IDs. If a task has Spec refs, only matching specs are included; otherwise the full phase spec section. */
  specsByTask: Record<string, string>;
  /** Per-task TLDR code structure analysis. Markdown-formatted summaries of exports, imports, functions, types. */
  codeStructureByTask: Record<string, string>;
  /** Directed explore queries extracted from phase content. Each has a query text and associated taskId. */
  exploreQueries: Array<{ query: string; taskId: string }>;
  content?: string;
  contentFile?: string;
} = {
  phaseNumber: phaseNum,
  phaseName: targetPhase.name,
  totalPhases: phases.length,
  planTitle,
  satellites,
  waves,
  tasks,
  cacheByTask,
  specsByTask,
  codeStructureByTask,
  exploreQueries,
};

if (conventions) {
  result.conventions = conventions;
  result.conventionSectionsByTask = conventionSectionsByTask;
}

if (fullContent.length > CONTENT_THRESHOLD) {
  const contextPath = resolve(projectRoot, CONTEXT_FILE);
  mkdirSync(dirname(contextPath), { recursive: true });
  writeFileSync(contextPath, fullContent, "utf-8");
  result.contentFile = CONTEXT_FILE;
} else {
  result.content = fullContent;
}

console.log(JSON.stringify(result, null, 2));
