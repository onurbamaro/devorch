// Contract: terminal-embutido — Bun.Terminal PTY over WebSocket.
import { tmuxName } from "./tmux";

export type TerminalMode = "ro" | "rw";

export type TerminalSocket = {
  send: (data: string | Uint8Array, compress?: boolean) => unknown;
};

export type AttachOpts = {
  session: string;
  mode: string;
  cols?: number;
  rows?: number;
};

export type PtyHandle = {
  write: (data: string) => number;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

export type AttachProcess = {
  kill: (signal?: number | NodeJS.Signals) => void;
  readonly exited: Promise<number>;
};

export type SpawnedAttach = {
  terminal: PtyHandle;
  proc: AttachProcess;
};

export type SpawnAttachFn = (
  argv: readonly string[],
  opts: {
    cols: number;
    rows: number;
    data: (chunk: Uint8Array) => void;
    env: Record<string, string | undefined>;
  },
) => SpawnedAttach;

export type TerminalBridge = {
  handleMessage: (raw: unknown) => Promise<void>;
  close: () => void;
};

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const TERM_ENV = "xterm-256color";

function defaultSpawn(
  argv: readonly string[],
  opts: {
    cols: number;
    rows: number;
    data: (chunk: Uint8Array) => void;
    env: Record<string, string | undefined>;
  },
): SpawnedAttach {
  const terminal = new Bun.Terminal({
    cols: opts.cols,
    rows: opts.rows,
    data(_term, chunk) {
      opts.data(chunk);
    },
    exit() {
      /* PTY cycle status — attach death is Subprocess.exited */
    },
    drain() {},
  });
  const proc = Bun.spawn([...argv], { terminal, env: opts.env });
  return { terminal, proc };
}

let spawnImpl: SpawnAttachFn = defaultSpawn;
let seamActive = false;

export function __setSpawnForTests(fn: SpawnAttachFn | null): void {
  spawnImpl = fn ?? defaultSpawn;
  seamActive = fn != null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMode(value: string): TerminalMode {
  return value === "rw" ? "rw" : "ro";
}

function attachArgv(session: string, mode: TerminalMode): string[] {
  const target = tmuxName(session);
  if (mode === "ro") return ["tmux", "attach-session", "-r", "-t", target];
  return ["tmux", "attach-session", "-t", target];
}

function sendBinary(ws: TerminalSocket, chunk: Uint8Array): void {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  try {
    ws.send(copy);
  } catch {
    /* socket gone */
  }
}

function sendJson(ws: TerminalSocket, payload: { type: "mode"; mode: TerminalMode } | { type: "exit" }): void {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* socket gone */
  }
}

export function attachTerminal(ws: TerminalSocket, opts: AttachOpts): TerminalBridge {
  let mode = parseMode(opts.mode);
  let cols = opts.cols ?? DEFAULT_COLS;
  let rows = opts.rows ?? DEFAULT_ROWS;
  let closed = false;
  let generation = 0;
  let terminal: PtyHandle | null = null;
  let proc: AttachProcess | null = null;
  let unlockChain: Promise<void> = Promise.resolve();

  const env: Record<string, string | undefined> = { ...process.env, TERM: TERM_ENV };

  function start(nextMode: TerminalMode): void {
    const gen = generation;
    const pair = spawnImpl(attachArgv(opts.session, nextMode), {
      cols,
      rows,
      data: (chunk) => {
        if (closed) return;
        sendBinary(ws, chunk);
      },
      env,
    });
    terminal = pair.terminal;
    proc = pair.proc;
    void pair.proc.exited.then(() => {
      if (closed || gen !== generation) return;
      sendJson(ws, { type: "exit" });
    });
  }

  async function unlock(): Promise<void> {
    if (closed || mode === "rw") return;
    generation += 1;
    const dying = proc;
    proc = null;
    if (dying) {
      try {
        dying.kill();
      } catch {
        /* already dead */
      }
      await dying.exited;
    }
    if (closed) return;
    mode = "rw";
    start("rw");
    sendJson(ws, { type: "mode", mode: "rw" });
  }

  start(mode);

  return {
    async handleMessage(raw: unknown): Promise<void> {
      if (closed || typeof raw !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isRecord(parsed) || typeof parsed.type !== "string") return;
      if (parsed.type === "input") {
        if (mode !== "rw") return;
        if (typeof parsed.data !== "string") return;
        terminal?.write(parsed.data);
        return;
      }
      if (parsed.type === "resize") {
        if (typeof parsed.cols !== "number" || typeof parsed.rows !== "number") return;
        if (!Number.isFinite(parsed.cols) || !Number.isFinite(parsed.rows)) return;
        cols = parsed.cols;
        rows = parsed.rows;
        terminal?.resize(cols, rows);
        try {
          // Bun.Terminal.resize sets the PTY size but tmux only re-reads it on SIGWINCH.
          proc?.kill("SIGWINCH");
        } catch {
          /* attach already gone */
        }
        if (!seamActive) {
          // A read-only client never drives tmux window sizing, so a detached
          // session stays 80x24 and tmux pads the rest with dots. Nudge the
          // window to the panel size; a writable client elsewhere wins it back.
          void Bun.spawn(
            ["tmux", "resize-window", "-t", tmuxName(opts.session), "-x", String(cols), "-y", String(rows)],
            { stdout: "ignore", stderr: "ignore" },
          ).exited.catch(() => {});
        }
        return;
      }
      if (parsed.type === "unlock") {
        unlockChain = unlockChain.then(unlock);
        await unlockChain;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      generation += 1;
      if (proc) {
        try {
          proc.kill();
        } catch {
          /* already dead */
        }
        proc = null;
      }
      if (terminal) {
        try {
          terminal.close();
        } catch {
          /* already closed */
        }
        terminal = null;
      }
    },
  };
}
