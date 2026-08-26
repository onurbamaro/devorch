// Contract: servidor-local — sessions listing, grouping, debounced watcher.
import { existsSync, readdirSync, readFileSync, watch } from "fs";
import { homedir } from "os";
import { join } from "path";

export type Stage =
  | "idea"
  | "spec-ready"
  | "build"
  | "blocked-on-spec"
  | "awaiting-merge"
  | "merged"
  | "failed";

export type SessionGroup = "blocked" | "running" | "ready" | "awaiting-merge" | "done";

export type SessionSummary = {
  name: string;
  stage: Stage;
  args: string;
  updatedAt: string;
  repos: string[];
  phasesDone: number;
  phasesTotal: number;
  phases: unknown[];
  gates: unknown;
  specConflicts: unknown[];
  group: SessionGroup;
};

export type SessionDetail = {
  name: string;
  createdAt: unknown;
  updatedAt: unknown;
  stage: Stage;
  args: unknown;
  repos: unknown;
  phases: unknown;
  gates: unknown;
  specConflicts: unknown;
  notes: unknown;
  models?: unknown;
  spec: {
    contracts: string[];
    specMd: string;
    decisionsMd: string;
  };
  baselines: string[];
  finalShots: string[];
};

function contractHeading(): RegExp {
  return /^## Contract:\s+(\S+)/gm;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStage(value: unknown): value is Stage {
  return (
    value === "idea" ||
    value === "spec-ready" ||
    value === "build" ||
    value === "blocked-on-spec" ||
    value === "awaiting-merge" ||
    value === "merged" ||
    value === "failed"
  );
}

export function resolveSessionsDir(): string {
  return process.env.DEVORCH_SESSIONS_DIR ?? join(homedir(), ".claude", "devorch-sessions");
}

export function groupForStage(stage: Stage): SessionGroup {
  switch (stage) {
    case "blocked-on-spec":
    case "failed":
      return "blocked";
    case "build":
    case "idea":
      return "running";
    case "spec-ready":
      return "ready";
    case "awaiting-merge":
      return "awaiting-merge";
    case "merged":
      return "done";
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

type ParsedSession = Record<string, unknown> & { name: string; stage: Stage };

function parseSessionFile(jsonPath: string): ParsedSession | null {
  if (!existsSync(jsonPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const name = parsed.name;
  const stage = parsed.stage;
  if (typeof name !== "string" || !isStage(stage)) return null;
  return { ...parsed, name, stage };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseContracts(specMd: string): string[] {
  const names: string[] = [];
  for (const match of specMd.matchAll(contractHeading())) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

function readText(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function listRelativeFiles(sessionDir: string, relativeDir: string): string[] {
  const abs = join(sessionDir, relativeDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${relativeDir}/${entry.name}`)
    .sort((a, b) => a.localeCompare(b));
}

export function listSessions(): SessionSummary[] {
  const dir = resolveSessionsDir();
  if (!existsSync(dir)) return [];

  const summaries: SessionSummary[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const parsed = parseSessionFile(join(dir, entry.name, "session.json"));
    if (!parsed) continue;

    const phases = Array.isArray(parsed.phases) ? parsed.phases : [];
    const repos = isRecord(parsed.repos) ? Object.keys(parsed.repos) : [];
    const specConflicts = Array.isArray(parsed.specConflicts) ? parsed.specConflicts : [];

    summaries.push({
      name: parsed.name,
      stage: parsed.stage,
      args: asString(parsed.args),
      updatedAt: asString(parsed.updatedAt),
      repos,
      phasesDone: phases.filter((phase) => isRecord(phase) && phase.status === "done").length,
      phasesTotal: phases.length,
      phases,
      gates: parsed.gates,
      specConflicts,
      group: groupForStage(parsed.stage),
    });
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export function readSession(name: string): SessionDetail | null {
  const sessionDir = join(resolveSessionsDir(), name);
  const parsed = parseSessionFile(join(sessionDir, "session.json"));
  if (!parsed) return null;

  const specMd = readText(join(sessionDir, "spec", "spec.md"));
  const decisionsMd = readText(join(sessionDir, "spec", "decisions.md"));

  return {
    name: parsed.name,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    stage: parsed.stage,
    args: parsed.args,
    repos: parsed.repos,
    phases: parsed.phases,
    gates: parsed.gates,
    specConflicts: parsed.specConflicts,
    notes: parsed.notes,
    models: parsed.models,
    spec: {
      contracts: parseContracts(specMd),
      specMd,
      decisionsMd,
    },
    baselines: listRelativeFiles(sessionDir, "spec/prototype/baselines"),
    finalShots: listRelativeFiles(sessionDir, "screenshots/final"),
  };
}

export function watchSessions(dir: string, onChange: () => void): () => void {
  if (!existsSync(dir)) return () => {};

  let disposed = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(dir, { recursive: true }, () => {
    if (disposed) return;
    if (timeout !== null) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      if (!disposed) onChange();
    }, 200);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    watcher.close();
  };
}
