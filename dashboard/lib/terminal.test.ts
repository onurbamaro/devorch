import { afterEach, expect, test } from "bun:test";
import {
  __setSpawnForTests,
  attachTerminal,
  type AttachProcess,
  type PtyHandle,
  type SpawnedAttach,
} from "./terminal";

afterEach(() => {
  __setSpawnForTests(null);
});

type Frame = { kind: "text"; value: string } | { kind: "bin"; bytes: number[] };

function fakeSocket(): { ws: { send: (data: string | Uint8Array) => void }; frames: Frame[] } {
  const frames: Frame[] = [];
  return {
    frames,
    ws: {
      send(data: string | Uint8Array) {
        if (typeof data === "string") {
          frames.push({ kind: "text", value: data });
          return;
        }
        frames.push({ kind: "bin", bytes: [...data] });
      },
    },
  };
}

function installFakePty(): {
  writes: string[];
  resizes: { cols: number; rows: number }[];
  closed: boolean[];
  argvs: string[][];
  terms: string[];
  procs: Array<AttachProcess & { killed: boolean }>;
} {
  const writes: string[] = [];
  const resizes: { cols: number; rows: number }[] = [];
  const closed: boolean[] = [];
  const argvs: string[][] = [];
  const terms: string[] = [];
  const procs: Array<AttachProcess & { killed: boolean }> = [];

  const terminal: PtyHandle = {
    write(data) {
      writes.push(data);
      return data.length;
    },
    resize(cols, rows) {
      resizes.push({ cols, rows });
    },
    close() {
      closed.push(true);
    },
  };

  __setSpawnForTests((argv, opts) => {
    argvs.push([...argv]);
    terms.push(opts.env.TERM ?? "");
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const proc: AttachProcess & { killed: boolean } = {
      killed: false,
      kill() {
        this.killed = true;
        resolveExit(0);
      },
      exited,
    };
    procs.push(proc);
    const pair: SpawnedAttach = { terminal, proc };
    return pair;
  });

  return { writes, resizes, closed, argvs, terms, procs };
}

test("ro drops input", async () => {
  const pty = installFakePty();
  const { ws } = fakeSocket();
  const bridge = attachTerminal(ws, { session: "demo-build", mode: "ro" });
  await bridge.handleMessage(JSON.stringify({ type: "input", data: "x" }));
  expect(pty.writes).toEqual([]);
  expect(pty.argvs[0]).toEqual(["tmux", "attach-session", "-r", "-t", "devorch-demo-build"]);
  expect(pty.terms[0]).toBe("xterm-256color");
  bridge.close();
});

test("unlock respawns without -r and then input flows", async () => {
  const pty = installFakePty();
  const { ws, frames } = fakeSocket();
  const bridge = attachTerminal(ws, { session: "demo-build", mode: "ro" });
  await bridge.handleMessage(JSON.stringify({ type: "unlock" }));
  expect(pty.argvs[1]).toEqual(["tmux", "attach-session", "-t", "devorch-demo-build"]);
  expect(frames).toEqual([{ kind: "text", value: '{"type":"mode","mode":"rw"}' }]);
  await bridge.handleMessage(JSON.stringify({ type: "input", data: "ls\n" }));
  expect(pty.writes).toEqual(["ls\n"]);
  expect(pty.procs[0]?.killed).toBe(true);
  bridge.close();
});

test("resize is called with the client's cols and rows", async () => {
  const pty = installFakePty();
  const { ws } = fakeSocket();
  const bridge = attachTerminal(ws, { session: "demo-build", mode: "ro" });
  await bridge.handleMessage(JSON.stringify({ type: "resize", cols: 132, rows: 43 }));
  expect(pty.resizes).toEqual([{ cols: 132, rows: 43 }]);
  bridge.close();
});

test("close kills only the attach subprocess", async () => {
  const pty = installFakePty();
  const { ws, frames } = fakeSocket();
  const bridge = attachTerminal(ws, { session: "demo-build", mode: "ro" });
  bridge.close();
  expect(pty.procs[0]?.killed).toBe(true);
  expect(pty.closed).toEqual([true]);
  expect(pty.argvs).toEqual([["tmux", "attach-session", "-r", "-t", "devorch-demo-build"]]);
  await Promise.resolve();
  expect(frames).toEqual([]);
});
