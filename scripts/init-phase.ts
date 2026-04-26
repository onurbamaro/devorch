/**
 * init-phase.ts — Compound phase init: plan context + gotchas + state + waves/tasks.
 * Usage: bun ~/.claude/devorch-scripts/init-phase.ts --plan <path> --phase <N>
 *                                                    [--explore-injection-tokens '<json>']
 * Output: JSON with phaseNumber, phaseName, totalPhases, planTitle, waves, tasks,
 *         gotchasByTask (per-task filtered + sanitized), gotchas (legacy concat),
 *         and content (or contentFile if >50000 chars).
 *
 * `--explore-injection-tokens` accepts a `Record<taskId, number>` JSON payload
 * where each value is the orchestrator's pre-estimate of the `## Explore
 * Findings` token cost it intends to inject for that task. When supplied, the
 * slice-size gate scores each task's effective slice as
 * `script-counted-tokens + (injection[taskId] ?? 0)` so warnings reflect what
 * the builder actually sees, not what the script can independently measure.
 *
 * Explore findings themselves are held by the orchestrator in-context and
 * curated into per-task builder prompts directly — no persistence, no
 * script-mediated filtering of finding content.
 */
import { existsSync, writeFileSync, mkdirSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { extractTagContent, parsePhaseBounds, readPlan, extractPlanTitle, extractSecondaryRepos, extractPhaseSpec, filterSpecsByRefs, extractExploreQueries } from "./lib/plan-parser";
import { safeReadFile } from "./lib/fs-utils";
import {
  extractFileRefs,
  parseGotchaEntries,
  sanitizeGotchaEntries,
  gotchaMatchesTask,
  type GotchaEntry,
} from "./lib/task-filter";
import {
  type ParsedWave,
  type ParsedTask,
  TOKEN_GATE_UNDER,
  TOKEN_GATE_OVER,
  parseWaves,
  parseTasks,
} from "./lib/slice-builder";

const CONTENT_THRESHOLD = 50000;
const CONTEXT_FILE = ".devorch/cache/phase-context.md";

interface SatelliteInfo {
  name: string;
  path: string;
  worktreePath: string;
}

const args = parseArgs<{ plan: string; phase: number; "explore-injection-tokens": string }>([
  { name: "plan", type: "string", required: true },
  { name: "phase", type: "number", required: true },
  { name: "explore-injection-tokens", type: "string", required: false },
]);

const planPath = args.plan;
const phaseNum = args.phase;

// Parse optional injection-tokens JSON. When absent or malformed, fall back to
// an empty map (slice-gate behaves as before, sizing only what the script can
// see). A malformed payload prints a stderr warning but is non-fatal so the
// orchestrator's pipeline keeps moving — the worst case is a slightly noisier
// `under` warning that the orchestrator's Step 9c logic already handles.
const exploreInjectionTokens: Record<string, number> = (() => {
  const raw = args["explore-injection-tokens"];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
          out[k] = v;
        }
      }
      return out;
    }
    console.error("[init-phase] --explore-injection-tokens: expected a JSON object of {taskId: number} — ignoring");
    return {};
  } catch (err) {
    console.error(`[init-phase] --explore-injection-tokens: failed to parse JSON (${err instanceof Error ? err.message : String(err)}) — ignoring`);
    return {};
  }
})();

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

// --- Read optional files (prefer GOTCHAS.md; fall back to legacy CONVENTIONS.md) ---
const gotchasPath = resolve(projectRoot, ".devorch/GOTCHAS.md");
const legacyConventionsPath = resolve(projectRoot, ".devorch/CONVENTIONS.md");
const primaryGotchasRaw = safeReadFile(existsSync(gotchasPath) ? gotchasPath : legacyConventionsPath);
const primaryGotchaEntries = sanitizeGotchaEntries(parseGotchaEntries(primaryGotchasRaw));

// Lazy per-satellite cache: only read each satellite's GOTCHAS.md when first
// task targeting that repo is processed. Keyed by satellite name.
const satelliteGotchaCache = new Map<string, GotchaEntry[]>();
function getSatelliteGotchas(repoName: string): GotchaEntry[] {
  const cached = satelliteGotchaCache.get(repoName);
  if (cached !== undefined) return cached;
  const sat = satellites.find((s) => s.name === repoName);
  if (!sat) {
    satelliteGotchaCache.set(repoName, []);
    return [];
  }
  const satGotchasPath = resolve(sat.worktreePath, ".devorch/GOTCHAS.md");
  const satLegacyPath = resolve(sat.worktreePath, ".devorch/CONVENTIONS.md");
  const raw = safeReadFile(existsSync(satGotchasPath) ? satGotchasPath : satLegacyPath);
  const entries = sanitizeGotchaEntries(parseGotchaEntries(raw));
  satelliteGotchaCache.set(repoName, entries);
  return entries;
}

// --- Read state: prefer cache/state.json (new), fall back to legacy state.md ---
const stateJsonPath = resolve(projectRoot, ".devorch/cache/state.json");
const stateMdPath = resolve(projectRoot, ".devorch/state.md");
let state = "";
if (existsSync(stateJsonPath)) {
  try {
    const raw = safeReadFile(stateJsonPath);
    const parsed = JSON.parse(raw) as { status?: string; lastPhase?: number; lastPhaseSummary?: string; updatedAt?: string };
    const lines: string[] = ["# devorch State"];
    if (typeof parsed.lastPhase === "number") lines.push(`- Last completed phase: ${parsed.lastPhase}`);
    if (typeof parsed.status === "string") lines.push(`- Status: ${parsed.status}`);
    if (typeof parsed.updatedAt === "string") lines.push(`- Updated: ${parsed.updatedAt}`);
    if (typeof parsed.lastPhaseSummary === "string" && parsed.lastPhaseSummary.length > 0) {
      const phaseHeader = typeof parsed.lastPhase === "number"
        ? `## Phase ${parsed.lastPhase} Summary`
        : "## Last Phase Summary";
      lines.push("", phaseHeader, parsed.lastPhaseSummary);
    }
    state = lines.join("\n");
  } catch {
    // Malformed JSON — fall through to legacy read
    state = safeReadFile(stateMdPath);
  }
} else {
  state = safeReadFile(stateMdPath);
}

const waves: ParsedWave[] = parseWaves(phaseContent);
const tasks: Record<string, ParsedTask> = parseTasks(phaseContent);

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
const projectMapPath = resolve(projectRoot, ".devorch/cache/project-map.md");
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

// --- Parallel subprocess execution: map-project + tldr-analyze ---
const phaseTsFiles = extractTsFiles(phaseContent);

async function runMapProject(): Promise<string> {
  if (isProjectMapFresh()) {
    return safeReadFile(projectMapPath);
  }
  const mapProc = Bun.spawn(
    ["bun", resolve(scriptDir, "map-project.ts"), projectRoot],
    { cwd: projectRoot, stderr: "pipe" }
  );
  const exitCode = await mapProc.exited;
  if (exitCode === 0) {
    const output = await new Response(mapProc.stdout).text();
    const trimmed = output.trim();
    try {
      mkdirSync(dirname(projectMapPath), { recursive: true });
      writeFileSync(projectMapPath, trimmed, "utf-8");
    } catch {
      // ignore — caching is best-effort
    }
    return trimmed;
  }
  return "";
}

async function runTldrAnalyze(): Promise<Record<string, string>> {
  if (phaseTsFiles.length === 0) return {};
  const tldrProc = Bun.spawn(
    ["bun", resolve(scriptDir, "tldr-analyze.ts"), "--files", phaseTsFiles.join(","), "--root", projectRoot],
    { cwd: projectRoot, stderr: "pipe" }
  );
  const exitCode = await tldrProc.exited;
  if (exitCode === 0) {
    const output = await new Response(tldrProc.stdout).text();
    try {
      const tldrResult: TldrResult = JSON.parse(output.trim());
      return formatTldrAnalysis(tldrResult);
    } catch {
      console.error(`[init-phase] TLDR analysis returned malformed JSON — skipping code structure context`);
      return {};
    }
  }
  console.error(`[init-phase] TLDR analysis failed (exit ${exitCode}) — skipping code structure context`);
  return {};
}

const [mapResult, tldrResult] = await Promise.allSettled([runMapProject(), runTldrAnalyze()]);

if (mapResult.status === "fulfilled") {
  projectMap = mapResult.value;
} else {
  console.error(`[init-phase] map-project error: ${mapResult.reason instanceof Error ? mapResult.reason.message : String(mapResult.reason)} — skipping project map`);
}

let tldrByFile: Record<string, string> = {};
if (tldrResult.status === "fulfilled") {
  tldrByFile = tldrResult.value;
} else {
  console.error(`[init-phase] TLDR analysis error: ${tldrResult.reason instanceof Error ? tldrResult.reason.message : String(tldrResult.reason)} — skipping code structure context`);
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

// tldrByFile and projectMap are populated above via parallel subprocess execution

// --- Extract explore queries from phase content ---
const exploreQueries = extractExploreQueries(phaseContent);

// --- Extract phase-level specs ---
const phaseSpecContent = extractPhaseSpec(phaseContent) || "";

// --- Build per-task filtered context ---
const specsByTask: Record<string, string> = {};
const codeStructureByTask: Record<string, string> = {};
const exemplarsByTask: Record<string, string[]> = {};
const nonGoalsByTask: Record<string, string> = {};
const gotchasByTask: Record<string, string> = {};

for (const [taskId, task] of Object.entries(tasks)) {
  const taskRefs = extractFileRefs(task.content);

  exemplarsByTask[taskId] = task.exemplars;
  nonGoalsByTask[taskId] = task.nonGoals;

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

  // Build per-task gotchas: primary entries always considered + satellite
  // entries when the task targets a satellite. Filter by task file refs;
  // entries without a file:line are global and pass through unconditionally.
  const candidateEntries: GotchaEntry[] = [...primaryGotchaEntries];
  if (task.repo && task.repo !== "primary") {
    candidateEntries.push(...getSatelliteGotchas(task.repo));
  }
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const entry of candidateEntries) {
    if (!gotchaMatchesTask(entry, taskRefs)) continue;
    if (seen.has(entry.raw)) continue;
    seen.add(entry.raw);
    matched.push(entry.raw);
  }
  gotchasByTask[taskId] = matched.join("\n");
}

// --- Per-task slice size gates (Principle 2: fresh context with filter gates) ---
/**
 * Approximate the token footprint of each task's injected slice and emit warnings
 * when it falls outside the healthy band. Rationale: Principle 2 of the v3 redesign
 * states subagents get curated, isolated context — if the filter yields too little
 * (<3K tokens) the task is likely under-contextualized and the builder will flail;
 * if it yields too much (>30K tokens) curation failed and we are back to bulk
 * context. Thresholds 3K/30K match the plan's explicit gate. Token approximation
 * uses `Math.ceil(charCount / 4)` — good enough to triage; exact counts are not
 * worth a tiktoken dependency here.
 *
 * Gotchas are now per-task (filtered + sanitized) so each task's slice size
 * reflects only the entries actually injected into its builder prompt.
 *
 * The optional `--explore-injection-tokens` flag lets the orchestrator
 * pre-declare how many tokens of `## Explore Findings` it plans to inject in
 * Step 9c per task. The slice gate adds those tokens to the script-counted
 * total, so the warning reflects the effective slice the builder will see —
 * not just what the script can measure on its own.
 */

const sliceWarnings: Array<{ taskId: string; tokens: number; direction: "under" | "over" }> = [];

for (const taskId of Object.keys(tasks)) {
  const specSlice = specsByTask[taskId] ?? "";
  const codeStructureSlice = codeStructureByTask[taskId] ?? "";
  const gotchaSlice = gotchasByTask[taskId] ?? "";

  const combined = gotchaSlice + specSlice + codeStructureSlice;
  const charCount = combined.length;
  const scriptTokens = charCount === 0 ? 0 : Math.ceil(charCount / 4);
  const injectionTokens = exploreInjectionTokens[taskId] ?? 0;
  const tokens = scriptTokens + injectionTokens;

  if (tokens < TOKEN_GATE_UNDER) {
    sliceWarnings.push({ taskId, tokens, direction: "under" });
  } else if (tokens > TOKEN_GATE_OVER) {
    sliceWarnings.push({ taskId, tokens, direction: "over" });
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

const fullContent = parts.join("\n");

// --- Output ---
const result: {
  phaseNumber: number;
  phaseName: string;
  totalPhases: number;
  planTitle: string;
  satellites: SatelliteInfo[];
  waves: ParsedWave[];
  tasks: Record<string, ParsedTask>;
  /** Legacy concatenated gotchas content (deduped union of all per-task entries). Kept for orchestrators built against the pre-`gotchasByTask` schema; new consumers should prefer `gotchasByTask`. */
  gotchas?: string;
  /** Per-task filtered + sanitized gotchas. Keys are task IDs. Value is a newline-joined list of entries: those whose file:line path overlaps the task's file refs (or are global, i.e. without explicit file:line). For tasks targeting a satellite repo, that repo's GOTCHAS.md is also merged. Empty string when nothing matches. */
  gotchasByTask: Record<string, string>;
  /** Per-task filtered spec contracts. Keys are task IDs. If a task has Spec refs, only matching specs are included; otherwise the full phase spec section. */
  specsByTask: Record<string, string>;
  /** Per-task TLDR code structure analysis. Markdown-formatted summaries of exports, imports, functions, types. */
  codeStructureByTask: Record<string, string>;
  /** Per-task exemplar file paths parsed from `**Exemplars**:` line. Empty array when absent. Every task id has an entry. */
  exemplarsByTask: Record<string, string[]>;
  /** Per-task non-goals text parsed from `**Non-goals**:` line. Empty string when absent. Every task id has an entry. */
  nonGoalsByTask: Record<string, string>;
  /** Directed explore queries extracted from phase content. Each has a query text and associated taskId. */
  exploreQueries: Array<{ query: string; taskId: string }>;
  /** Per-task slice-size gate warnings. `under` = <3K tokens (likely under-contextualized); `over` = >30K tokens (curation failed). Empty array when all tasks are within bounds. See Principle 2. */
  sliceWarnings: Array<{ taskId: string; tokens: number; direction: "under" | "over" }>;
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
  gotchasByTask,
  specsByTask,
  codeStructureByTask,
  exemplarsByTask,
  nonGoalsByTask,
  exploreQueries,
  sliceWarnings,
};

// Legacy `gotchas` field: dedup'd concatenation of every per-task entry.
// Spec contract `gotchas-by-task-schema` requires emitting both the new
// per-task map and a concatenated string for orchestrators on the older
// schema. Order follows first-appearance across tasks.
{
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const taskGotchas of Object.values(gotchasByTask)) {
    if (!taskGotchas) continue;
    for (const line of taskGotchas.split("\n")) {
      if (!line) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      ordered.push(line);
    }
  }
  if (ordered.length > 0) {
    result.gotchas = ordered.join("\n");
  }
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
