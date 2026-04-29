/**
 * validate-plan.ts — Slim validator for v2 plan format.
 * Checks: required blocks, phase/task structure, DAG acyclicity,
 * file disjunction within phase + across parallel phases.
 *
 * Usage: bun ~/.claude/devorch-scripts/validate-plan.ts --plan <path>
 * Output: JSON {ok, errors: [{rule, message, where?}], warnings: [...]}
 *
 * The orchestrator handles implicit-touch judgment after this script clears.
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "./lib/args";

interface Issue { rule: string; message: string; where?: string; }

const args = parseArgs<{ plan: string }>([
  { name: "plan", type: "string", required: true },
]);

const planPath = resolve(args.plan);
if (!existsSync(planPath)) {
  console.log(JSON.stringify({ ok: false, errors: [{ rule: "file-exists", message: `Plan file not found: ${planPath}` }], warnings: [] }));
  process.exit(0);
}

const content = readFileSync(planPath, "utf-8");
const errors: Issue[] = [];
const warnings: Issue[] = [];

// Required top-level blocks
const REQUIRED_BLOCKS = ["description", "objective", "classification", "decisions"];
for (const tag of REQUIRED_BLOCKS) {
  if (!new RegExp(`<${tag}>`).test(content)) {
    errors.push({ rule: "required-block", message: `Missing <${tag}> block` });
  }
}

// Plan title
if (!/^#\s+Plan:\s+\S+/m.test(content)) {
  errors.push({ rule: "title", message: "Missing '# Plan: <name>' header" });
}

// Phases
interface Phase {
  id: string;
  name: string;
  body: string;
  status?: string;
  dependsOn: string[];
  tasks: Task[];
}
interface Task {
  id: string;
  files: string[];
}

const phaseRe = /<phase\s+id="([^"]+)"\s+name="([^"]+)"([^>]*?)>([\s\S]*?)<\/phase>/g;
const phases: Phase[] = [];
let m: RegExpExecArray | null;
while ((m = phaseRe.exec(content)) !== null) {
  const id = m[1];
  const name = m[2];
  const attrs = m[3] || "";
  const body = m[4];
  const status = /\sstatus="([^"]+)"/.exec(attrs)?.[1];

  const dependsRaw = /<depends-on>([^<]*)<\/depends-on>/.exec(body)?.[1] || "";
  const dependsOn = dependsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const tasks: Task[] = [];
  const tasksBlock = /<tasks>([\s\S]*?)<\/tasks>/.exec(body)?.[1] || "";
  const taskRe = /####\s+\d+\.\s+([^\n]+)([\s\S]*?)(?=####\s+\d+\.|$)/g;
  let tm: RegExpExecArray | null;
  while ((tm = taskRe.exec(tasksBlock)) !== null) {
    const taskBody = tm[2];
    const idMatch = /\*\*ID\*\*:\s*([^\n]+)/.exec(taskBody);
    const filesMatch = /\*\*Files\*\*:\s*([^\n]+)/.exec(taskBody);
    if (!idMatch) {
      errors.push({ rule: "task-id", message: `Task in phase "${id}" missing **ID**`, where: id });
      continue;
    }
    const taskId = idMatch[1].trim().replace(/^[`*]|[`*]$/g, "");
    const filesRaw = filesMatch?.[1] || "";
    const files = filesRaw.split(",").map((f) => f.trim().replace(/^[`*]|[`*]$/g, "")).filter(Boolean);
    if (files.length === 0) {
      errors.push({ rule: "task-files", message: `Task "${taskId}" missing **Files** list`, where: `${id}/${taskId}` });
    }
    tasks.push({ id: taskId, files });
  }

  phases.push({ id, name, body, status, dependsOn, tasks });
}

if (phases.length === 0) {
  errors.push({ rule: "phases", message: "No <phase> blocks found" });
}

// Phase ID uniqueness
const idCounts = new Map<string, number>();
for (const p of phases) idCounts.set(p.id, (idCounts.get(p.id) || 0) + 1);
for (const [id, count] of idCounts.entries()) {
  if (count > 1) errors.push({ rule: "phase-id-unique", message: `Phase id "${id}" used ${count} times`, where: id });
}

// depends-on references valid phase ids
const phaseIds = new Set(phases.map((p) => p.id));
for (const p of phases) {
  for (const dep of p.dependsOn) {
    if (!phaseIds.has(dep)) {
      errors.push({ rule: "depends-on-valid", message: `Phase "${p.id}" depends on unknown phase "${dep}"`, where: p.id });
    }
  }
}

// DAG cycle detection (Kahn's algorithm)
const indeg = new Map<string, number>();
const fwd = new Map<string, string[]>();
for (const p of phases) {
  indeg.set(p.id, 0);
  fwd.set(p.id, []);
}
for (const p of phases) {
  for (const dep of p.dependsOn) {
    if (!phaseIds.has(dep)) continue;
    indeg.set(p.id, (indeg.get(p.id) || 0) + 1);
    fwd.get(dep)!.push(p.id);
  }
}
const queue: string[] = [];
for (const [id, deg] of indeg.entries()) if (deg === 0) queue.push(id);
let visited = 0;
while (queue.length) {
  const id = queue.shift()!;
  visited++;
  for (const next of fwd.get(id) || []) {
    indeg.set(next, indeg.get(next)! - 1);
    if (indeg.get(next) === 0) queue.push(next);
  }
}
if (visited < phases.length) {
  errors.push({ rule: "dag-acyclic", message: `Plan has cycles: ${phases.length - visited} phase(s) unreachable from no-dep roots` });
}

// File disjunction within each phase
for (const p of phases) {
  const seen = new Map<string, string>();
  for (const t of p.tasks) {
    for (const f of t.files) {
      if (seen.has(f)) {
        errors.push({
          rule: "intra-phase-disjoint",
          message: `Phase "${p.id}": tasks "${seen.get(f)}" and "${t.id}" both touch "${f}"`,
          where: p.id,
        });
      } else {
        seen.set(f, t.id);
      }
    }
  }
}

// File disjunction across parallel phases (no dep chain in either direction)
function transitiveDeps(start: string): Set<string> {
  const out = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    const phase = phases.find((p) => p.id === cur);
    if (!phase) continue;
    for (const dep of phase.dependsOn) {
      if (!out.has(dep)) { out.add(dep); stack.push(dep); }
    }
  }
  return out;
}
function reachable(a: string, b: string): boolean {
  // Is `b` reachable from `a` via deps in either direction?
  return transitiveDeps(a).has(b) || transitiveDeps(b).has(a);
}

for (let i = 0; i < phases.length; i++) {
  for (let j = i + 1; j < phases.length; j++) {
    const a = phases[i];
    const b = phases[j];
    if (reachable(a.id, b.id)) continue; // serial — no overlap concern
    const aFiles = new Set(a.tasks.flatMap((t) => t.files));
    for (const t of b.tasks) {
      for (const f of t.files) {
        if (aFiles.has(f)) {
          errors.push({
            rule: "parallel-phase-disjoint",
            message: `Phases "${a.id}" and "${b.id}" run concurrently but both touch "${f}"`,
            where: `${a.id}+${b.id}`,
          });
        }
      }
    }
  }
}

console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings }));
