import { afterEach, expect, test } from "bun:test";
import {
  __setSpawnForTests,
  buildStartCommand,
  deriveSlug,
  ideaCommand,
  mergeCommand,
  resumeCommand,
  spawnInTmux,
  startBuild,
} from "./tmux";

afterEach(() => {
  __setSpawnForTests(null);
});

test("buildStartCommand includes all four model roles", () => {
  expect(
    buildStartCommand("demo-spec-ready", {
      builder: "grok",
      fixer: "sonnet",
      explore: "haiku",
      visual: "opus",
    }),
  ).toBe(
    "claude '/devorch build demo-spec-ready --headless --models builder=grok,fixer=sonnet,explore=haiku,visual=opus'",
  );
});

test("buildStartCommand omits inherit and empty roles", () => {
  expect(
    buildStartCommand("foo", {
      builder: "grok",
      fixer: "inherit",
      explore: "haiku",
      visual: "inherit",
    }),
  ).toBe("claude '/devorch build foo --headless --models builder=grok,explore=haiku'");
});

test("buildStartCommand omits --models when every role is inherit", () => {
  expect(
    buildStartCommand("foo", {
      builder: "inherit",
      fixer: "inherit",
      explore: "inherit",
      visual: "inherit",
    }),
  ).toBe("claude '/devorch build foo --headless'");
});

test("resumeCommand and mergeCommand wrap the claude payload", () => {
  expect(resumeCommand("foo")).toBe("claude '/devorch build foo --resume'");
  expect(mergeCommand("foo")).toBe("claude '/devorch merge foo'");
});

test("ideaCommand single-quote-escapes apostrophes in the description", () => {
  expect(ideaCommand(`don't "break"`, false)).toBe(
    `claude '/devorch idea "don'\\''t "break""'`,
  );
});

test("ideaCommand puts --prototype inside the quoted claude argument", () => {
  expect(ideaCommand("pix checkout", true)).toBe(
    `claude '/devorch idea "pix checkout" --prototype'`,
  );
});

test("deriveSlug strips accents and caps at four words", () => {
  expect(deriveSlug("Dashboard de sessões Devorch Hub")).toBe(
    "dashboard-de-sessoes-devorch",
  );
  expect(deriveSlug("don't break this extra word")).toBe("dont-break-this-extra");
});

test("startBuild does not spawn when tmux already has the session", async () => {
  const calls: string[][] = [];
  __setSpawnForTests(async (argv) => {
    calls.push([...argv]);
    return { exitCode: 0 };
  });
  const result = await startBuild({ name: "foo", stage: "spec-ready" }, {});
  expect(result).toEqual({ started: false, stage: "spec-ready" });
  expect(calls).toEqual([["tmux", "has-session", "-t", "devorch-foo"]]);
});

test("startBuild does not spawn when stage is already build", async () => {
  const calls: string[][] = [];
  __setSpawnForTests(async (argv) => {
    calls.push([...argv]);
    return { exitCode: 1 };
  });
  const result = await startBuild({ name: "foo", stage: "build" }, {});
  expect(result).toEqual({ started: false, stage: "build" });
  expect(calls).toEqual([["tmux", "has-session", "-t", "devorch-foo"]]);
});

test("startBuild creates a detached tmux session when absent", async () => {
  const calls: string[][] = [];
  __setSpawnForTests(async (argv) => {
    calls.push([...argv]);
    if (argv[1] === "has-session") return { exitCode: 1 };
    return { exitCode: 0 };
  });
  const result = await startBuild({ name: "foo", stage: "spec-ready" }, {});
  expect(result).toEqual({ started: true, stage: "spec-ready" });
  expect(calls).toContainEqual([
    "tmux",
    "new-session",
    "-d",
    "-s",
    "devorch-foo",
    "claude '/devorch build foo --headless'",
  ]);
});

test("spawnInTmux opens a new-window when the session already exists", async () => {
  const calls: string[][] = [];
  __setSpawnForTests(async (argv) => {
    calls.push([...argv]);
    if (argv[1] === "has-session") return { exitCode: 0 };
    return { exitCode: 0 };
  });
  await spawnInTmux("devorch-foo", "claude '/devorch merge foo'");
  expect(calls).toEqual([
    ["tmux", "has-session", "-t", "devorch-foo"],
    ["tmux", "new-window", "-t", "devorch-foo", "claude '/devorch merge foo'"],
  ]);
});
