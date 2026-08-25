import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startHub, type Hub } from "./server";
import { __setSpawnForTests } from "./lib/tmux";

const FIXTURES = join(import.meta.dir, "fixtures/sessions");
const ENV_SESSIONS = "DEVORCH_SESSIONS_DIR";
const ENV_PORT = "DEVORCH_HUB_PORT";
const ENV_HOST = "DEVORCH_HUB_HOST";

let sessionsDir = "";
let hub: Hub | null = null;
let saved: { sessions?: string; port?: string; host?: string } = {};
const spawnCalls: string[][] = [];
const liveTmux = new Set<string>();

function baseUrl(): string {
  if (!hub) throw new Error("hub not started");
  return `http://127.0.0.1:${hub.port}`;
}

async function readSseMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let acc = "";
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      reader.read(),
      Bun.sleep(remaining).then(() => null),
    ]);
    if (chunk === null) break;
    if (chunk.done) break;
    acc += new TextDecoder().decode(chunk.value);
    const split = acc.indexOf("\n\n");
    if (split >= 0) return acc.slice(0, split + 2);
  }
  throw new Error(`SSE timeout, got: ${acc}`);
}

beforeEach(() => {
  saved = {
    sessions: process.env[ENV_SESSIONS],
    port: process.env[ENV_PORT],
    host: process.env[ENV_HOST],
  };
  sessionsDir = mkdtempSync(join(tmpdir(), "devorch-hub-"));
  for (const entry of readdirSync(FIXTURES, { withFileTypes: true })) {
    cpSync(join(FIXTURES, entry.name), join(sessionsDir, entry.name), { recursive: true });
  }
  process.env[ENV_SESSIONS] = sessionsDir;
  process.env[ENV_PORT] = "0";
  process.env[ENV_HOST] = "0.0.0.0";
  spawnCalls.length = 0;
  liveTmux.clear();
  __setSpawnForTests(async (argv) => {
    spawnCalls.push([...argv]);
    if (argv[1] === "has-session") {
      const target = argv[3];
      return { exitCode: target && liveTmux.has(target) ? 0 : 1 };
    }
    if (argv[1] === "new-session") {
      const name = argv[4];
      if (name) liveTmux.add(name);
    }
    return { exitCode: 0 };
  });
  hub = startHub();
});

afterEach(() => {
  hub?.stop();
  hub = null;
  __setSpawnForTests(null);
  rmSync(sessionsDir, { recursive: true, force: true });
  if (saved.sessions === undefined) delete process.env[ENV_SESSIONS];
  else process.env[ENV_SESSIONS] = saved.sessions;
  if (saved.port === undefined) delete process.env[ENV_PORT];
  else process.env[ENV_PORT] = saved.port;
  if (saved.host === undefined) delete process.env[ENV_HOST];
  else process.env[ENV_HOST] = saved.host;
});

test("hostname is 127.0.0.1 even with DEVORCH_HUB_HOST=0.0.0.0", () => {
  expect(hub?.hostname).toBe("127.0.0.1");
  expect(process.env[ENV_HOST]).toBe("0.0.0.0");
});

test("GET /api/sessions lists fixtures with stage phases gates specConflicts group", async () => {
  const res = await fetch(`${baseUrl()}/api/sessions`);
  expect(res.status).toBe(200);
  const body: unknown = await res.json();
  expect(isRecord(body)).toBe(true);
  if (!isRecord(body) || !Array.isArray(body.sessions)) throw new Error("shape");
  const byName = new Map<string, Record<string, unknown>>();
  for (const row of body.sessions) {
    if (isRecord(row) && typeof row.name === "string") byName.set(row.name, row);
  }
  expect([...byName.keys()].sort()).toEqual([
    "demo-blocked",
    "demo-build",
    "demo-merge",
    "demo-spec-ready",
  ]);
  expect(byName.get("demo-spec-ready")?.stage).toBe("spec-ready");
  expect(byName.get("demo-spec-ready")?.group).toBe("ready");
  expect(byName.get("demo-build")?.stage).toBe("build");
  expect(byName.get("demo-build")?.group).toBe("running");
  expect(byName.get("demo-build")?.phasesDone).toBe(2);
  expect(byName.get("demo-build")?.phasesTotal).toBe(5);
  expect(byName.get("demo-blocked")?.stage).toBe("blocked-on-spec");
  expect(byName.get("demo-blocked")?.group).toBe("blocked");
  expect(Array.isArray(byName.get("demo-blocked")?.specConflicts)).toBe(true);
  expect((byName.get("demo-blocked")?.specConflicts as unknown[]).length).toBe(1);
  expect(byName.get("demo-merge")?.stage).toBe("awaiting-merge");
  expect(byName.get("demo-merge")?.group).toBe("awaiting-merge");
  expect(byName.get("demo-merge")?.gates).toEqual({ mechanical: "pass", visual: "pass" });
});

test("GET /api/sessions/:name includes spec contracts and baselines", async () => {
  const res = await fetch(`${baseUrl()}/api/sessions/demo-spec-ready`);
  expect(res.status).toBe(200);
  const body: unknown = await res.json();
  expect(isRecord(body)).toBe(true);
  if (!isRecord(body) || !isRecord(body.spec)) throw new Error("shape");
  expect(body.spec.contracts).toEqual(["checkout-pix", "confirmacao"]);
  expect(body.baselines).toEqual(["spec/prototype/baselines/home.desktop.png"]);
});

test("files endpoint blocks traversal and non png/md", async () => {
  const traversal = await fetch(
    `${baseUrl()}/api/sessions/demo-spec-ready/files/${encodeURIComponent("../package.json")}`,
  );
  expect(traversal.status).toBe(403);
  const jsonFile = await fetch(
    `${baseUrl()}/api/sessions/demo-blocked/files/session.json`,
  );
  expect(jsonFile.status).toBe(403);
  const png = await fetch(
    `${baseUrl()}/api/sessions/demo-spec-ready/files/spec/prototype/baselines/home.desktop.png`,
  );
  expect(png.status).toBe(200);
});

test("POST build is idempotent via tmux seam", async () => {
  const models = { builder: "grok", fixer: "sonnet", explore: "haiku", visual: "opus" };
  const first = await fetch(`${baseUrl()}/api/sessions/demo-spec-ready/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  });
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({
    ok: true,
    started: true,
    stage: "spec-ready",
  });
  const cmd =
    "claude '/devorch build demo-spec-ready --headless --models builder=grok,fixer=sonnet,explore=haiku,visual=opus'";
  expect(spawnCalls).toEqual([
    ["tmux", "has-session", "-t", "devorch-demo-spec-ready"],
    ["tmux", "has-session", "-t", "devorch-demo-spec-ready"],
    ["tmux", "new-session", "-d", "-s", "devorch-demo-spec-ready", cmd],
  ]);

  spawnCalls.length = 0;
  const second = await fetch(`${baseUrl()}/api/sessions/demo-spec-ready/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  });
  expect(await second.json()).toEqual({
    ok: true,
    started: false,
    stage: "spec-ready",
  });
  expect(spawnCalls).toEqual([["tmux", "has-session", "-t", "devorch-demo-spec-ready"]]);

  spawnCalls.length = 0;
  const alreadyBuilding = await fetch(`${baseUrl()}/api/sessions/demo-build/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  });
  expect(await alreadyBuilding.json()).toEqual({
    ok: true,
    started: false,
    stage: "build",
  });
  expect(spawnCalls).toEqual([["tmux", "has-session", "-t", "devorch-demo-build"]]);
});

test("POST conflicts writes amendment, clears, spawns resume; resend is already", async () => {
  const freeText = "Manter 200 com QR, sem 402.";
  const first = await fetch(`${baseUrl()}/api/sessions/demo-blocked/conflicts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contract: "checkout-pix", freeText }),
  });
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ ok: true, already: false });

  const decisions = readFileSync(join(sessionsDir, "demo-blocked", "spec", "decisions.md"), "utf-8");
  expect(decisions.includes("## Amendment (2026-08-25): checkout-pix")).toBe(true);
  expect(decisions.includes("- **Conflict**: O endpoint devolve 402 quando o spec pede 200 com QR.")).toBe(
    true,
  );
  expect(decisions.includes(`- **Decision**: ${freeText}`)).toBe(true);

  const session = JSON.parse(
    readFileSync(join(sessionsDir, "demo-blocked", "session.json"), "utf-8"),
  ) as { specConflicts: unknown[] };
  expect(session.specConflicts).toEqual([]);

  const resumeCmd = "claude '/devorch build demo-blocked --resume'";
  expect(spawnCalls.some((argv) => argv[1] === "new-session" && argv[5] === resumeCmd)).toBe(true);

  spawnCalls.length = 0;
  const second = await fetch(`${baseUrl()}/api/sessions/demo-blocked/conflicts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contract: "checkout-pix", freeText }),
  });
  expect(await second.json()).toEqual({ ok: true, already: true });
  expect(spawnCalls).toEqual([]);
  const once = decisions.split("## Amendment").length - 1;
  const after = readFileSync(join(sessionsDir, "demo-blocked", "spec", "decisions.md"), "utf-8");
  expect(after.split("## Amendment").length - 1).toBe(once);
  expect(once).toBe(1);
});

test("POST merge and POST idea spawn the exact tmux commands", async () => {
  const merge = await fetch(`${baseUrl()}/api/sessions/demo-merge/merge`, { method: "POST" });
  expect(await merge.json()).toEqual({ ok: true });
  expect(spawnCalls).toEqual([
    ["tmux", "has-session", "-t", "devorch-demo-merge"],
    [
      "tmux",
      "new-session",
      "-d",
      "-s",
      "devorch-demo-merge",
      "claude '/devorch merge demo-merge'",
    ],
  ]);

  spawnCalls.length = 0;
  const idea = await fetch(`${baseUrl()}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "pix no app", prototype: true }),
  });
  expect(await idea.json()).toEqual({ ok: true, tmux: "devorch-pix-no-app" });
  expect(spawnCalls).toEqual([
    ["tmux", "has-session", "-t", "devorch-pix-no-app"],
    [
      "tmux",
      "new-session",
      "-d",
      "-s",
      "devorch-pix-no-app",
      "claude '/devorch idea \"pix no app\" --prototype'",
    ],
  ]);
});

test("SSE emits sessions event within 1s after touching a fixture file", async () => {
  const res = await fetch(`${baseUrl()}/api/events`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")?.startsWith("text/event-stream")).toBe(true);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const initial = await readSseMessage(reader, 1000);
  expect(initial.startsWith("event: sessions\n")).toBe(true);

  const target = join(sessionsDir, "demo-build", "session.json");
  const current = readFileSync(target, "utf-8");
  writeFileSync(target, current.replace("2026-08-20T12:00:00.000Z", "2026-08-20T12:00:01.000Z"));
  const next = await readSseMessage(reader, 1000);
  expect(next.startsWith("event: sessions\n")).toBe(true);
  const dataLine = next.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error("no data line");
  const parsed: unknown = JSON.parse(dataLine.slice("data: ".length));
  expect(isRecord(parsed)).toBe(true);
  if (!isRecord(parsed) || !Array.isArray(parsed.sessions)) throw new Error("sse payload");
  expect(parsed.sessions.length).toBe(4);
  await reader.cancel();
});

test("GET /api/terminal/:name without websocket upgrade is 426", async () => {
  const res = await fetch(`${baseUrl()}/api/terminal/demo-build?mode=ro`);
  expect(res.status).toBe(426);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
