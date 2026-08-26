/**
 * session.ts — Global session registry for devorch idea/build/merge.
 *
 * Sessions live OUTSIDE any repo, at ~/.claude/devorch-sessions/<name>/:
 *   session.json   — live status (stage, repos, phases, gates)
 *   spec/          — output of /devorch idea (spec.md, decisions.md, manifest.json, prototype/)
 *   plan.md        — output of /devorch build planning stage
 *   screenshots/   — visual-gate evidence, per round
 *
 * Usage:
 *   bun session.ts init --name <kebab> [--args "<description>"] [--stage idea]
 *   bun session.ts update --name <n> --patch '<json>'    # recursive merge; null deletes a key
 *   bun session.ts get --name <n>
 *   bun session.ts list [--status <stage>]
 *   bun session.ts dir --name <n>
 *
 * Stages: idea | spec-ready | build | blocked-on-spec | awaiting-merge | merged | failed
 * Output: JSON on stdout. Exit 0 on success, exit 1 with {ok:false,...} on errors.
 * Writes are atomic (temp file + rename) so concurrent readers (dashboard SSE,
 * statusline) never observe a torn session.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SESSIONS_ROOT = join(homedir(), ".claude", "devorch-sessions");

const argv = process.argv.slice(2);
const action = argv[0];

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function emit(obj: Record<string, unknown>): never {
  console.log(JSON.stringify(obj));
  process.exit(obj.ok === false ? 1 : 0);
}

function sessionPath(name: string): string {
  return join(SESSIONS_ROOT, name, "session.json");
}

function readSession(name: string): Record<string, any> | null {
  const p = sessionPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function writeSession(name: string, data: Record<string, any>): void {
  data.updatedAt = new Date().toISOString();
  const target = sessionPath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, target);
}

/** RFC7386-style merge: objects merge recursively, null deletes, everything else replaces. */
function mergePatch(target: any, patch: any): any {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = typeof target === "object" && target !== null && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

if (action === "init") {
  const base = flag("name");
  if (!base) emit({ ok: false, error: "init requires --name" });
  mkdirSync(SESSIONS_ROOT, { recursive: true });

  // Collision suffixing, mirroring setup-worktree.ts behavior
  let name = base!;
  let suffix = 1;
  while (existsSync(join(SESSIONS_ROOT, name))) {
    suffix += 1;
    name = `${base}-${suffix}`;
    if (suffix > 99) emit({ ok: false, error: `No free session name after 99 suffixes for '${base}'` });
  }

  const dir = join(SESSIONS_ROOT, name);
  mkdirSync(join(dir, "spec", "prototype", "baselines"), { recursive: true });
  mkdirSync(join(dir, "screenshots"), { recursive: true });

  const session = {
    name,
    createdAt: new Date().toISOString(),
    updatedAt: "",
    stage: flag("stage") || "idea",
    args: flag("args") || "",
    repos: {},
    phases: [],
    gates: { mechanical: "pending", visual: "pending" },
    specConflicts: [],
    notes: [],
  };
  writeSession(name, session);
  emit({ ok: true, name, dir: dir.replaceAll("\\", "/"), suffixed: name !== base, session });
}

if (action === "update") {
  const name = flag("name");
  const patchRaw = flag("patch");
  if (!name || !patchRaw) emit({ ok: false, error: "update requires --name and --patch" });
  const session = readSession(name!);
  if (!session) emit({ ok: false, error: `Session not found or unreadable: ${name}` });
  let patch: any;
  try {
    patch = JSON.parse(patchRaw!);
  } catch (e) {
    emit({ ok: false, error: `Invalid JSON in --patch: ${e}` });
  }
  const merged = mergePatch(session, patch);
  merged.name = name; // name is immutable
  writeSession(name!, merged);
  emit({ ok: true, session: merged });
}

if (action === "get") {
  const name = flag("name");
  if (!name) emit({ ok: false, error: "get requires --name" });
  const session = readSession(name!);
  if (!session) emit({ ok: false, error: `Session not found: ${name}` });
  emit({ ok: true, dir: join(SESSIONS_ROOT, name!).replaceAll("\\", "/"), session });
}

if (action === "dir") {
  const name = flag("name");
  if (!name) emit({ ok: false, error: "dir requires --name" });
  emit({ ok: true, dir: join(SESSIONS_ROOT, name!).replaceAll("\\", "/"), exists: existsSync(join(SESSIONS_ROOT, name!)) });
}

if (action === "list") {
  const status = flag("status");
  if (!existsSync(SESSIONS_ROOT)) emit({ ok: true, count: 0, sessions: [] });
  const sessions = readdirSync(SESSIONS_ROOT)
    .map((entry) => readSession(entry))
    .filter((s): s is Record<string, any> => s !== null)
    .filter((s) => !status || s.stage === status)
    .map((s) => ({
      name: s.name,
      stage: s.stage,
      args: s.args,
      repos: Object.keys(s.repos || {}),
      phasesDone: (s.phases || []).filter((p: any) => p.status === "done").length,
      phasesTotal: (s.phases || []).length,
      updatedAt: s.updatedAt,
      dir: join(SESSIONS_ROOT, s.name).replaceAll("\\", "/"),
    }))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  emit({ ok: true, count: sessions.length, sessions });
}

emit({ ok: false, error: `Unknown action: ${action}. Use init|update|get|dir|list` });
