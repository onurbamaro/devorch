/**
 * dag-scheduler.ts — Computes the next ready set of phases from a v2 plan.
 * A phase is "ready" when:
 *   - It does not yet have status="done"
 *   - All its <depends-on> phases have status="done"
 *   - Its declared files don't overlap with phases currently in `--running`
 *
 * Usage: bun ~/.claude/devorch-scripts/dag-scheduler.ts --plan <path> [--running id1,id2]
 * Output: JSON {ready: [phaseId], blocked: [{id, reason}], done: [phaseId], running: [phaseId], totalPhases}
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{ plan: string; running: string }>([
  { name: "plan", type: "string", required: true },
  { name: "running", type: "string", required: false },
]);

const planPath = resolve(args.plan);
if (!existsSync(planPath)) {
  console.error(`Plan file not found: ${planPath}`);
  process.exit(1);
}

const content = readFileSync(planPath, "utf-8");
const runningSet = new Set((args.running || "").split(",").map((s) => s.trim()).filter(Boolean));

interface Phase {
  id: string;
  status?: string;
  dependsOn: string[];
  files: string[];
}

const phaseRe = /<phase\s+id="([^"]+)"\s+name="[^"]+"([^>]*?)>([\s\S]*?)<\/phase>/g;
const phases: Phase[] = [];
let m: RegExpExecArray | null;
while ((m = phaseRe.exec(content)) !== null) {
  const id = m[1];
  const attrs = m[2] || "";
  const body = m[3];
  const status = /\sstatus="([^"]+)"/.exec(attrs)?.[1];
  const dependsRaw = /<depends-on>([^<]*)<\/depends-on>/.exec(body)?.[1] || "";
  const dependsOn = dependsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const files: string[] = [];
  const tasksBlock = /<tasks>([\s\S]*?)<\/tasks>/.exec(body)?.[1] || "";
  const taskRe = /\*\*Files\*\*:\s*([^\n]+)/g;
  let tm: RegExpExecArray | null;
  while ((tm = taskRe.exec(tasksBlock)) !== null) {
    const list = tm[1].split(",").map((f) => f.trim().replace(/^[`*]|[`*]$/g, "")).filter(Boolean);
    files.push(...list);
  }

  phases.push({ id, status, dependsOn, files });
}

const doneIds = new Set(phases.filter((p) => p.status === "done").map((p) => p.id));
const ready: string[] = [];
const blocked: { id: string; reason: string }[] = [];
const allRunningFiles = new Set(
  phases.filter((p) => runningSet.has(p.id)).flatMap((p) => p.files),
);

for (const p of phases) {
  if (p.status === "done") continue;
  if (runningSet.has(p.id)) continue;

  // Check deps
  const unmetDeps = p.dependsOn.filter((d) => !doneIds.has(d));
  if (unmetDeps.length > 0) {
    blocked.push({ id: p.id, reason: `waiting for: ${unmetDeps.join(", ")}` });
    continue;
  }

  // Check file overlap with running phases
  const overlap = p.files.filter((f) => allRunningFiles.has(f));
  if (overlap.length > 0) {
    blocked.push({ id: p.id, reason: `file overlap with running: ${overlap.join(", ")}` });
    continue;
  }

  ready.push(p.id);
}

console.log(JSON.stringify({
  ready,
  blocked,
  done: [...doneIds],
  running: [...runningSet],
  totalPhases: phases.length,
}));
