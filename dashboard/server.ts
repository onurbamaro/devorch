import { existsSync } from "fs";
import { extname, join, resolve } from "path";
import { appendAmendment, clearConflict } from "./lib/amend";
import { listSessions, readSession, resolveSessionsDir, watchSessions } from "./lib/sessions";
import { attachTerminal, type TerminalBridge } from "./lib/terminal";
import {
  startBuild,
  startIdea,
  startMerge,
  startResume,
  type BuildModels,
} from "./lib/tmux";

const HOST = "127.0.0.1";
const ROOT = join(import.meta.dir, "..");
const ASSETS: Record<string, string> = {
  "/assets/xterm.js": join(ROOT, "node_modules/@xterm/xterm/lib/xterm.js"),
  "/assets/xterm.css": join(ROOT, "node_modules/@xterm/xterm/css/xterm.css"),
  "/assets/addon-fit.js": join(ROOT, "node_modules/@xterm/addon-fit/lib/addon-fit.js"),
};

export type Hub = {
  hostname: string;
  port: number;
  stop: () => void;
};

type SseController = ReadableStreamDefaultController<Uint8Array>;

type SocketData = {
  name: string;
  mode: string;
  bridge: TerminalBridge | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function encodeSse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: sessions\ndata: ${JSON.stringify(data)}\n\n`);
}

function sessionsPayload(): { sessions: ReturnType<typeof listSessions> } {
  return { sessions: listSessions() };
}

function parseModels(value: unknown): BuildModels {
  if (!isRecord(value)) return {};
  const models: BuildModels = {};
  for (const role of ["builder", "fixer", "explore", "visual"] as const) {
    const entry = value[role];
    if (typeof entry === "string") models[role] = entry;
  }
  return models;
}

async function readBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function decisionText(body: Record<string, unknown>): string {
  if (typeof body.freeText === "string" && body.freeText.length > 0) return body.freeText;
  const choice = typeof body.choice === "string" ? body.choice : "";
  const note = typeof body.note === "string" ? body.note : "";
  if (choice.length > 0 && note.length > 0) return `${choice} — ${note}`;
  if (choice.length > 0) return choice;
  return note;
}

function isSafeSessionName(name: string): boolean {
  return name.length > 0 && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

function isInside(root: string, target: string): boolean {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return target === root || target.startsWith(prefix);
}

function serveSessionFile(name: string, relpath: string): Response {
  const decoded = decodeURIComponent(relpath);
  if (decoded.includes("..") || decoded.startsWith("/") || decoded.startsWith("\\")) {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  const ext = extname(decoded).toLowerCase();
  if (ext !== ".png" && ext !== ".md") {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  const sessionRoot = resolve(join(resolveSessionsDir(), name));
  const target = resolve(sessionRoot, decoded);
  if (!isInside(sessionRoot, target)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  if (!existsSync(target)) return json({ ok: false, error: "not found" }, 404);
  return new Response(Bun.file(target));
}

export function startHub(opts?: { port?: number }): Hub {
  const port = opts?.port ?? Number(process.env.DEVORCH_HUB_PORT ?? 7777);
  const sessionsDir = resolveSessionsDir();
  const clients = new Set<SseController>();

  const pushSessions = (): void => {
    const chunk = encodeSse(sessionsPayload());
    for (const controller of clients) {
      try {
        controller.enqueue(chunk);
      } catch {
        clients.delete(controller);
      }
    }
  };

  const unwatch = watchSessions(sessionsDir, pushSessions);

  const server = Bun.serve<SocketData>({
    hostname: HOST,
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      if (pathname.startsWith("/api/terminal/")) {
        const name = decodeURIComponent(pathname.slice("/api/terminal/".length));
        if (!isSafeSessionName(name) || name.includes("/")) {
          return json({ ok: false, error: "not found" }, 404);
        }
        const mode = url.searchParams.get("mode") === "rw" ? "rw" : "ro";
        const upgraded = srv.upgrade(req, { data: { name, mode, bridge: null } });
        if (!upgraded) return new Response("upgrade failed", { status: 426 });
        return;
      }

      if (req.method === "GET" && pathname === "/") {
        const index = join(import.meta.dir, "public", "index.html");
        if (!existsSync(index)) return new Response("not found", { status: 404 });
        return new Response(Bun.file(index));
      }

      if (req.method === "GET" && pathname in ASSETS) {
        const file = ASSETS[pathname];
        if (!file || !existsSync(file)) return new Response("not found", { status: 404 });
        return new Response(Bun.file(file));
      }

      if (req.method === "GET" && pathname === "/api/sessions") {
        return json(sessionsPayload());
      }

      if (req.method === "GET" && pathname === "/api/events") {
        srv.timeout(req, 0);
        let controller: SseController;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            clients.add(c);
            c.enqueue(encodeSse(sessionsPayload()));
          },
          cancel() {
            clients.delete(controller);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      const filesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/files\/(.+)$/);
      if (req.method === "GET" && filesMatch && filesMatch[1] && filesMatch[2]) {
        const name = decodeURIComponent(filesMatch[1]);
        if (!isSafeSessionName(name)) return json({ ok: false, error: "forbidden" }, 403);
        return serveSessionFile(name, filesMatch[2]);
      }

      const buildMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/build$/);
      if (req.method === "POST" && buildMatch && buildMatch[1]) {
        const name = decodeURIComponent(buildMatch[1]);
        const session = readSession(name);
        if (!session) return json({ ok: false, error: "not found" }, 404);
        const body = await readBody(req);
        const models = isRecord(body) ? parseModels(body.models) : {};
        const result = await startBuild({ name: session.name, stage: session.stage }, models);
        console.log(`POST /api/sessions/${name}/build started=${result.started}`);
        return json({ ok: true, started: result.started, stage: result.stage });
      }

      const conflictsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/conflicts$/);
      if (req.method === "POST" && conflictsMatch && conflictsMatch[1]) {
        const name = decodeURIComponent(conflictsMatch[1]);
        const session = readSession(name);
        if (!session) return json({ ok: false, error: "not found" }, 404);
        const body = await readBody(req);
        if (!isRecord(body) || typeof body.contract !== "string" || body.contract.length === 0) {
          return json({ ok: false, error: "contract required" }, 400);
        }
        const contract = body.contract;
        const sessionDir = join(resolveSessionsDir(), name);
        const appended = appendAmendment(sessionDir, {
          contract,
          decisionText: decisionText(body),
        });
        if (appended.already) {
          console.log(`POST /api/sessions/${name}/conflicts already=true`);
          return json({ ok: true, already: true });
        }
        clearConflict(sessionDir, contract);
        await startResume(name);
        console.log(`POST /api/sessions/${name}/conflicts contract=${contract}`);
        return json({ ok: true, already: false });
      }

      const mergeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/merge$/);
      if (req.method === "POST" && mergeMatch && mergeMatch[1]) {
        const name = decodeURIComponent(mergeMatch[1]);
        if (!readSession(name)) return json({ ok: false, error: "not found" }, 404);
        await startMerge(name);
        console.log(`POST /api/sessions/${name}/merge`);
        return json({ ok: true });
      }

      if (req.method === "POST" && pathname === "/api/sessions") {
        const body = await readBody(req);
        if (!isRecord(body) || typeof body.description !== "string" || body.description.length === 0) {
          return json({ ok: false, error: "description required" }, 400);
        }
        const prototype = body.prototype === true;
        const result = await startIdea(body.description, prototype);
        console.log(`POST /api/sessions tmux=${result.tmux}`);
        return json({ ok: true, tmux: result.tmux });
      }

      const detailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (req.method === "GET" && detailMatch && detailMatch[1]) {
        const name = decodeURIComponent(detailMatch[1]);
        const session = readSession(name);
        if (!session) return json({ ok: false, error: "not found" }, 404);
        return json(session);
      }

      return json({ ok: false, error: "not found" }, 404);
    },
    websocket: {
      open(ws) {
        ws.data.bridge = attachTerminal(ws, { session: ws.data.name, mode: ws.data.mode });
      },
      message(ws, message) {
        void ws.data.bridge?.handleMessage(message);
      },
      close(ws) {
        ws.data.bridge?.close();
        ws.data.bridge = null;
      },
    },
  });

  const hostname = server.hostname;
  const boundPort = server.port;
  if (hostname === undefined || boundPort === undefined) {
    unwatch();
    server.stop(true);
    throw new Error("Devorch Hub failed to bind");
  }

  return {
    hostname,
    port: boundPort,
    stop() {
      unwatch();
      for (const controller of clients) {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
      clients.clear();
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const hub = startHub();
  console.log(`Devorch Hub http://${hub.hostname}:${hub.port}`);
}
