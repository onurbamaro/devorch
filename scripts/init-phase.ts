/**
 * init-phase.ts — Compound phase init: plan context + gotchas + waves/tasks.
 * Usage: bun ~/.claude/devorch-scripts/init-phase.ts --plan <path> --phase <N>
 *                                                    [--explore-injection-tokens '<json>']
 *                                                    [--legacy-json]
 *
 * Default output: compact stdout JSON with shape
 *   `{ok, phaseNumber, phaseName, totalPhases, planTitle, satellites, waves,
 *     taskIds, sliceWarnings, detailPath}`. Per-task detail (gotchas, specs,
 *   code structure, exemplars, non-goals) is written to disk as one markdown
 *   file per task at `<projectRoot>/.devorch/cache/phase-init-<N>/<task-id>.md`.
 *   The orchestrator reads those files via Read tool when assembling builder
 *   prompts (commands/devorch.md Step 9c). The legacy concatenated `content` /
 *   `contentFile` field is not emitted in default mode.
 *
 * With `--legacy-json`: stdout JSON additionally includes the legacy per-task
 * fields (`gotchasByTask`, `codeStructureByTask`, `specsByTask`,
 * `exemplarsByTask`, `nonGoalsByTask`) plus the legacy concatenated `gotchas`
 * field. Disk markdown files are written either way.
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
import { parsePhaseBounds, readPlan, extractPlanTitle, extractSecondaryRepos, extractPhaseSpec, filterSpecsByRefs } from "./lib/plan-parser";
import { safeReadFile } from "./lib/fs-utils";
import { CACHE_FRESHNESS_MS } from "./lib/constants";
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

interface SatelliteInfo {
  name: string;
  path: string;
  worktreePath: string;
}

const args = parseArgs<{ plan: string; phase: number; "explore-injection-tokens": string; "legacy-json": boolean }>([
  { name: "plan", type: "string", required: true },
  { name: "phase", type: "number", required: true },
  { name: "explore-injection-tokens", type: "string", required: false },
  { name: "legacy-json", type: "boolean", required: false },
]);

const planPath = args.plan;
const phaseNum = args.phase;
const legacyJson = args["legacy-json"];

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

// --- Extract phase content ---
const phaseContent = targetPhase.content;

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

// --- Run map-project.ts for project structure (cached to disk for any tool that wants it) ---
const scriptDir = import.meta.dirname;
const projectMapPath = resolve(projectRoot, ".devorch/cache/project-map.md");

function isProjectMapFresh(): boolean {
  try {
    if (!existsSync(projectMapPath)) return false;
    const mtime = statSync(projectMapPath).mtimeMs;
    return mtime > Date.now() - CACHE_FRESHNESS_MS;
  } catch {
    return false;
  }
}

// --- Parallel subprocess execution: map-project + tldr-analyze ---
const phaseTsFiles = extractTsFiles(phaseContent);

async function runMapProject(): Promise<void> {
  if (isProjectMapFresh()) return;
  const mapProc = Bun.spawn(
    ["bun", resolve(scriptDir, "map-project.ts"), projectRoot],
    { cwd: projectRoot, stderr: "pipe" }
  );
  const exitCode = await mapProc.exited;
  if (exitCode !== 0) return;
  const output = await new Response(mapProc.stdout).text();
  try {
    mkdirSync(dirname(projectMapPath), { recursive: true });
    writeFileSync(projectMapPath, output.trim(), "utf-8");
  } catch {
    // ignore — caching is best-effort
  }
}

/**
 * Group `phaseTsFiles` by inferred owning task's `repo`. For each file, find
 * the first task whose file refs include it and use that task's repo. Files
 * not referenced by any task or referenced only by `"primary"` tasks belong
 * to the primary group. Returns a Record<repoName, files[]> where `"primary"`
 * is the well-known key for the main repo.
 */
function groupFilesByRepo(files: string[]): Record<string, string[]> {
  // Build file→repo index once: O(T) extractFileRefs calls instead of O(F·T).
  const fileToRepo = new Map<string, string>();
  for (const task of Object.values(tasks)) {
    const refs = extractFileRefs(task.content);
    for (const ref of refs) {
      if (!fileToRepo.has(ref)) fileToRepo.set(ref, task.repo || "primary");
    }
  }
  const groups: Record<string, string[]> = {};
  for (const file of files) {
    const owningRepo = fileToRepo.get(file) ?? "primary";
    if (!groups[owningRepo]) groups[owningRepo] = [];
    groups[owningRepo].push(file);
  }
  return groups;
}

/**
 * Run `tldr-analyze.ts` for one repo group. Returns a Record<absolutePath,
 * markdownSection> with keys re-resolved against `repoRoot` (handles either
 * absolute or relative keys returned by tldr-analyze).
 */
async function runTldrForRepo(repoFiles: string[], repoRoot: string, repoLabel: string): Promise<Record<string, string>> {
  if (repoFiles.length === 0) return {};
  const tldrProc = Bun.spawn(
    ["bun", resolve(scriptDir, "tldr-analyze.ts"), "--files", repoFiles.join(","), "--root", repoRoot],
    { cwd: repoRoot, stderr: "pipe" }
  );
  const exitCode = await tldrProc.exited;
  if (exitCode !== 0) {
    console.error(`[init-phase] TLDR analysis for repo '${repoLabel}' failed (exit ${exitCode}) — skipping code structure for that repo`);
    return {};
  }
  const output = await new Response(tldrProc.stdout).text();
  try {
    const tldrResult: TldrResult = JSON.parse(output.trim());
    const formatted = formatTldrAnalysis(tldrResult);
    // Re-resolve every key against repoRoot. resolve() is idempotent when the
    // path is already absolute, so this both normalises relative keys and
    // leaves absolute keys untouched.
    const remapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(formatted)) {
      remapped[resolve(repoRoot, k)] = v;
    }
    return remapped;
  } catch {
    console.error(`[init-phase] TLDR analysis for repo '${repoLabel}' returned malformed JSON — skipping code structure for that repo`);
    return {};
  }
}

async function runTldrAnalyze(): Promise<Record<string, string>> {
  if (phaseTsFiles.length === 0) return {};
  const fileGroups = groupFilesByRepo(phaseTsFiles);

  // Map each non-empty group to a (repoLabel, repoRoot, files) tuple.
  const jobs: Array<{ label: string; root: string; files: string[] }> = [];
  for (const [repo, files] of Object.entries(fileGroups)) {
    if (files.length === 0) continue;
    if (repo === "primary") {
      jobs.push({ label: "primary", root: projectRoot, files });
    } else {
      const sat = satellites.find((s) => s.name === repo);
      if (!sat) {
        // Unknown repo — fold into primary so files are still analyzed
        // somewhere instead of being silently dropped.
        console.error(`[init-phase] task references unknown repo '${repo}' for tldr — analyzing under primary root`);
        jobs.push({ label: "primary", root: projectRoot, files });
      } else {
        jobs.push({ label: repo, root: sat.worktreePath, files });
      }
    }
  }

  if (jobs.length === 0) return {};

  const settled = await Promise.allSettled(jobs.map((j) => runTldrForRepo(j.files, j.root, j.label)));

  const merged: Record<string, string> = {};
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const job = jobs[i];
    if (res.status === "fulfilled") {
      Object.assign(merged, res.value);
    } else {
      console.error(`[init-phase] TLDR analysis for repo '${job.label}' rejected: ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
    }
  }
  return merged;
}

const [mapResult, tldrResult] = await Promise.allSettled([runMapProject(), runTldrAnalyze()]);

if (mapResult.status === "rejected") {
  console.error(`[init-phase] map-project error: ${mapResult.reason instanceof Error ? mapResult.reason.message : String(mapResult.reason)} — skipping project map cache refresh`);
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

// tldrByFile is populated above via parallel subprocess execution

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
 * not just what the script can measure on its own. `under` fires only when no
 * injection is planned for the task: a task with injection > 0 is a signal
 * the orchestrator already knows it will augment the slice, so a low
 * script-side count is noise. `over` always fires regardless of injection.
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

  // Suppress "under" warnings when the orchestrator declared explore-injection
  // tokens for this task: the slice is augmented downstream, so a low script-side
  // count is not a signal. "Over" still fires regardless — curation failed even
  // with injection on top.
  if (tokens < TOKEN_GATE_UNDER && injectionTokens === 0) {
    sliceWarnings.push({ taskId, tokens, direction: "under" });
  } else if (tokens > TOKEN_GATE_OVER) {
    sliceWarnings.push({ taskId, tokens, direction: "over" });
  }
}

// --- Per-task disk detail files ---
// Always write one markdown file per task at
// `<projectRoot>/.devorch/cache/phase-init-<N>/<task-id>.md`. The orchestrator
// reads these via Read tool when assembling builder prompts (commands/devorch.md
// Step 9c). Files are written regardless of mode (default or `--legacy-json`).
const detailRel = `.devorch/cache/phase-init-${phaseNum}/`;
const detailDirAbs = resolve(projectRoot, detailRel);
try {
  mkdirSync(detailDirAbs, { recursive: true });
} catch (err) {
  console.error(`[init-phase] failed to create detail dir ${detailDirAbs}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

for (const taskId of Object.keys(tasks)) {
  const sections: string[] = [];

  const specSection = specsByTask[taskId] ?? "";
  if (specSection) {
    sections.push("## Spec Contracts");
    sections.push("");
    sections.push(specSection);
    sections.push("");
  }

  const codeSection = codeStructureByTask[taskId] ?? "";
  if (codeSection) {
    sections.push("## Code Structure");
    sections.push("");
    sections.push(codeSection);
    sections.push("");
  }

  const gotchaSection = gotchasByTask[taskId] ?? "";
  if (gotchaSection) {
    sections.push("## Gotchas");
    sections.push("");
    sections.push(gotchaSection);
    sections.push("");
  }

  const exemplarsList = exemplarsByTask[taskId] ?? [];
  if (exemplarsList.length > 0) {
    sections.push("## Exemplars");
    sections.push("");
    sections.push(exemplarsList.join("\n"));
    sections.push("");
  }

  const nonGoalsSection = nonGoalsByTask[taskId] ?? "";
  if (nonGoalsSection) {
    sections.push("## Non-goals");
    sections.push("");
    sections.push(nonGoalsSection);
    sections.push("");
  }

  const detailFile = resolve(detailDirAbs, `${taskId}.md`);
  // Write even when sections is empty: keep the file present so the orchestrator
  // does not hit a missing-file error mid-dispatch. Empty body is a valid
  // signal that this task has no curated context to inject.
  try {
    writeFileSync(detailFile, sections.join("\n"), "utf-8");
  } catch (err) {
    console.error(`[init-phase] failed to write detail file ${detailFile}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// --- Output ---
interface InitPhaseOutput {
  ok: true;
  phaseNumber: number;
  phaseName: string;
  totalPhases: number;
  planTitle: string;
  satellites: SatelliteInfo[];
  waves: ParsedWave[];
  /** Flat list of every task ID in the phase, in plan-declaration order. */
  taskIds: string[];
  /** Per-task slice-size gate warnings. `under` = <TOKEN_GATE_UNDER tokens AND no explore-injection planned (likely under-contextualized); `over` = >TOKEN_GATE_OVER tokens (curation failed, regardless of injection). Empty array when all tasks are within bounds. See Principle 2. */
  sliceWarnings: Array<{ taskId: string; tokens: number; direction: "under" | "over" }>;
  /** Project-root-relative directory where per-task markdown detail files live. Trailing slash included. */
  detailPath: string;
  // Legacy fields — only emitted when `--legacy-json` is set.
  gotchasByTask?: Record<string, string>;
  specsByTask?: Record<string, string>;
  codeStructureByTask?: Record<string, string>;
  exemplarsByTask?: Record<string, string[]>;
  nonGoalsByTask?: Record<string, string>;
  /** Legacy concatenated gotchas content (deduped union of all per-task entries). Only emitted under `--legacy-json`. */
  gotchas?: string;
}

const result: InitPhaseOutput = {
  ok: true,
  phaseNumber: phaseNum,
  phaseName: targetPhase.name,
  totalPhases: phases.length,
  planTitle,
  satellites,
  waves,
  taskIds: Object.keys(tasks),
  sliceWarnings,
  detailPath: detailRel,
};

if (legacyJson) {
  result.gotchasByTask = gotchasByTask;
  result.specsByTask = specsByTask;
  result.codeStructureByTask = codeStructureByTask;
  result.exemplarsByTask = exemplarsByTask;
  result.nonGoalsByTask = nonGoalsByTask;

  // Legacy `gotchas` field: dedup'd concatenation of every per-task entry.
  // Order follows first-appearance across tasks.
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

console.log(JSON.stringify(result, null, 2));
