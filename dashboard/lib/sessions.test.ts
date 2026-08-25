// Contract under test: servidor-local.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listSessions, readSession, watchSessions } from "./sessions";

const FIXTURES = join(import.meta.dir, "../fixtures/sessions");
const ENV_KEY = "DEVORCH_SESSIONS_DIR";
const DEMO_NAMES = ["demo-blocked", "demo-build", "demo-merge", "demo-spec-ready"];
const SUMMARY_KEYS = [
  "args",
  "gates",
  "group",
  "name",
  "phases",
  "phasesDone",
  "phasesTotal",
  "repos",
  "specConflicts",
  "stage",
  "updatedAt",
];

let sessionsDir = "";
let savedEnv: string | undefined;
const disposers: Array<() => void> = [];

function namesOfListed(): string[] {
  return listSessions()
    .map((session) => session.name)
    .sort((a, b) => a.localeCompare(b));
}

function writeMinimalSession(name: string, stage: string): void {
  mkdirSync(join(sessionsDir, name), { recursive: true });
  writeFileSync(
    join(sessionsDir, name, "session.json"),
    `${JSON.stringify({
      name,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      stage,
      args: "",
      repos: {},
      phases: [],
      gates: { mechanical: "pending", visual: "pending" },
      specConflicts: [],
      notes: [],
    })}\n`,
  );
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  sessionsDir = mkdtempSync(join(tmpdir(), "devorch-sessions-"));
  for (const entry of readdirSync(FIXTURES, { withFileTypes: true })) {
    cpSync(join(FIXTURES, entry.name), join(sessionsDir, entry.name), { recursive: true });
  }
  process.env[ENV_KEY] = sessionsDir;
});

afterEach(() => {
  while (disposers.length > 0) {
    const dispose = disposers.pop();
    if (dispose) dispose();
  }
  rmSync(sessionsDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

test("listing shape", () => {
  const sessions = listSessions();
  expect(namesOfListed()).toEqual(DEMO_NAMES);

  const byName = new Map(sessions.map((session) => [session.name, session]));
  expect(Object.keys(byName.get("demo-blocked") ?? {}).sort()).toEqual(SUMMARY_KEYS);
  expect(Object.keys(byName.get("demo-build") ?? {}).sort()).toEqual(SUMMARY_KEYS);
  expect(Object.keys(byName.get("demo-merge") ?? {}).sort()).toEqual(SUMMARY_KEYS);
  expect(Object.keys(byName.get("demo-spec-ready") ?? {}).sort()).toEqual(SUMMARY_KEYS);

  expect(byName.get("demo-build")?.phasesTotal).toBe(5);
  expect(byName.get("demo-build")?.phasesDone).toBe(2);
  expect(byName.get("demo-blocked")?.specConflicts).toHaveLength(1);
});

test("group mapping", () => {
  writeMinimalSession("demo-failed", "failed");
  writeMinimalSession("demo-idea", "idea");
  writeMinimalSession("demo-merged", "merged");

  const byName = new Map(listSessions().map((session) => [session.name, session]));
  expect(byName.get("demo-spec-ready")?.group).toBe("ready");
  expect(byName.get("demo-build")?.group).toBe("running");
  expect(byName.get("demo-blocked")?.group).toBe("blocked");
  expect(byName.get("demo-merge")?.group).toBe("awaiting-merge");
  expect(byName.get("demo-failed")?.group).toBe("blocked");
  expect(byName.get("demo-idea")?.group).toBe("running");
  expect(byName.get("demo-merged")?.group).toBe("done");
});

test("torn-JSON tolerance", () => {
  mkdirSync(join(sessionsDir, "demo-torn"), { recursive: true });
  writeFileSync(join(sessionsDir, "demo-torn", "session.json"), "{not-json");

  const names = namesOfListed();
  expect(names.includes("demo-torn")).toBe(false);
  expect(names).toEqual(DEMO_NAMES);
});

test("readSession extras", () => {
  const ready = readSession("demo-spec-ready");
  expect(ready?.spec.contracts).toEqual(["checkout-pix", "confirmacao"]);
  expect(ready?.baselines.includes("spec/prototype/baselines/home.desktop.png")).toBe(true);

  const merge = readSession("demo-merge");
  expect(merge?.finalShots.includes("screenshots/final/home.desktop.png")).toBe(true);

  const build = readSession("demo-build");
  expect(build?.spec.contracts).toEqual([]);
  expect(build?.spec.specMd).toBe("");
});

test("watchSessions debounce is trailing and disposed cleanly", async () => {
  let count = 0;
  const dispose = watchSessions(sessionsDir, () => {
    count += 1;
  });
  disposers.push(dispose);

  const target = join(sessionsDir, "demo-build", "session.json");
  for (let i = 0; i < 5; i++) {
    writeFileSync(
      target,
      `${JSON.stringify({
        name: "demo-build",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        stage: "build",
        args: "",
        repos: {},
        phases: [],
        gates: { mechanical: "pending", visual: "pending" },
        specConflicts: [],
        notes: [`burst-${i}`],
      })}\n`,
    );
  }

  await Bun.sleep(50);
  expect(count).toBe(0);
  await Bun.sleep(250);
  expect(count).toBe(1);

  writeFileSync(
    target,
    `${JSON.stringify({
      name: "demo-build",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      stage: "build",
      args: "",
      repos: {},
      phases: [],
      gates: { mechanical: "pending", visual: "pending" },
      specConflicts: [],
      notes: ["after-burst"],
    })}\n`,
  );
  await Bun.sleep(250);
  expect(count).toBe(2);

  dispose();
  writeFileSync(
    target,
    `${JSON.stringify({
      name: "demo-build",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      stage: "build",
      args: "",
      repos: {},
      phases: [],
      gates: { mechanical: "pending", visual: "pending" },
      specConflicts: [],
      notes: ["after-dispose"],
    })}\n`,
  );
  await Bun.sleep(250);
  expect(count).toBe(2);
});
