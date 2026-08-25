export type SpawnResult = { exitCode: number; stdout?: string; stderr?: string };
export type SpawnFn = (argv: readonly string[]) => Promise<SpawnResult>;

export type BuildModels = {
  builder?: string;
  fixer?: string;
  explore?: string;
  visual?: string;
};

async function defaultSpawn(argv: readonly string[]): Promise<SpawnResult> {
  const proc = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  return { exitCode: proc.exitCode ?? 1 };
}

let spawnImpl: SpawnFn = defaultSpawn;

export function __setSpawnForTests(fn: SpawnFn | null): void {
  spawnImpl = fn ?? defaultSpawn;
}

export function tmuxName(session: string): string {
  return `devorch-${session}`;
}

export async function hasSession(name: string): Promise<boolean> {
  const result = await spawnImpl(["tmux", "has-session", "-t", name]);
  return result.exitCode === 0;
}

export async function spawnInTmux(name: string, shellCommand: string): Promise<void> {
  if (await hasSession(name)) {
    await spawnImpl(["tmux", "new-window", "-t", name, shellCommand]);
    return;
  }
  await spawnImpl(["tmux", "new-session", "-d", "-s", name, shellCommand]);
}

function shSingleQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

const MODEL_ROLES = ["builder", "fixer", "explore", "visual"] as const;

export function buildStartCommand(session: string, models: BuildModels): string {
  const assigned: string[] = [];
  for (const role of MODEL_ROLES) {
    const value = models[role];
    if (value == null || value === "" || value === "inherit") continue;
    assigned.push(`${role}=${value}`);
  }
  let payload = `/devorch build ${session} --headless`;
  if (assigned.length > 0) {
    payload += ` --models ${assigned.join(",")}`;
  }
  return `claude ${shSingleQuote(payload)}`;
}

export function resumeCommand(session: string): string {
  return `claude ${shSingleQuote(`/devorch build ${session} --resume`)}`;
}

export function mergeCommand(session: string): string {
  return `claude ${shSingleQuote(`/devorch merge ${session}`)}`;
}

export function ideaCommand(description: string, prototype: boolean): string {
  let payload = `/devorch idea "${description}"`;
  if (prototype) payload += " --prototype";
  return `claude ${shSingleQuote(payload)}`;
}

export function deriveSlug(description: string): string {
  const stripped = description.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words: string[] = [];
  for (const raw of stripped.split(/\s+/)) {
    if (raw.length === 0) continue;
    const kept = raw.replace(/[^a-z0-9]/g, "");
    if (kept.length === 0) continue;
    words.push(kept);
    if (words.length === 4) break;
  }
  return words.join("-");
}

export async function startBuild(
  session: { name: string; stage: string },
  models: BuildModels,
): Promise<{ started: boolean; stage: string }> {
  const name = tmuxName(session.name);
  const exists = await hasSession(name);
  if (exists || session.stage === "build") {
    return { started: false, stage: session.stage };
  }
  await spawnInTmux(name, buildStartCommand(session.name, models));
  return { started: true, stage: session.stage };
}

export async function startResume(sessionName: string): Promise<void> {
  await spawnInTmux(tmuxName(sessionName), resumeCommand(sessionName));
}

export async function startMerge(sessionName: string): Promise<void> {
  await spawnInTmux(tmuxName(sessionName), mergeCommand(sessionName));
}

export async function startIdea(
  description: string,
  prototype: boolean,
): Promise<{ tmux: string; slug: string }> {
  const slug = deriveSlug(description);
  const tmux = tmuxName(slug);
  await spawnInTmux(tmux, ideaCommand(description, prototype));
  return { tmux, slug };
}
