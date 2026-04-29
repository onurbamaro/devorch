/**
 * assemble-task-prompt.ts — Builds the per-task builder prompt body
 * by extracting plan section + spec contracts + filtered gotchas.
 *
 * Usage: bun ~/.claude/devorch-scripts/assemble-task-prompt.ts \
 *          --plan <plan.md> --task-id <kebab-id> --worktree <path> \
 *          [--gotchas <gotchas.md>]
 * Output: JSON {ok, prompt, files: [...], specRefs: [...], warnings: [...]}
 *
 * The orchestrator wraps the returned `prompt` with Working directory,
 * Plan Objective, and any Explore findings before sending to the Task tool.
 */
import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{ plan: string; "task-id": string; worktree: string; gotchas: string }>([
  { name: "plan", type: "string", required: true },
  { name: "task-id", type: "string", required: true },
  { name: "worktree", type: "string", required: true },
  { name: "gotchas", type: "string", required: false },
]);

const planPath = resolve(args.plan);
const taskId = args["task-id"];
const worktreePath = resolve(args.worktree);
const gotchasPath = args.gotchas
  ? resolve(args.gotchas)
  : join(worktreePath, ".devorch", "GOTCHAS.md");

if (!existsSync(planPath)) {
  console.log(JSON.stringify({ ok: false, prompt: "", files: [], specRefs: [], warnings: [`Plan not found: ${planPath}`] }));
  process.exit(0);
}

const content = readFileSync(planPath, "utf-8");

// Find phase that contains this task
const phaseRe = /<phase\s+id="([^"]+)"\s+name="([^"]+)"([^>]*?)>([\s\S]*?)<\/phase>/g;
let foundPhase: { id: string; name: string; body: string } | null = null;
let foundTaskBlock: string | null = null;
let mPhase: RegExpExecArray | null;
while ((mPhase = phaseRe.exec(content)) !== null) {
  const phaseBody = mPhase[4];
  const tasksBlock = /<tasks>([\s\S]*?)<\/tasks>/.exec(phaseBody)?.[1] || "";
  const taskRe = /(####\s+\d+\.\s+[^\n]+[\s\S]*?)(?=####\s+\d+\.|$)/g;
  let mTask: RegExpExecArray | null;
  while ((mTask = taskRe.exec(tasksBlock)) !== null) {
    const block = mTask[1];
    const idLine = /\*\*ID\*\*:\s*([^\n]+)/.exec(block)?.[1]?.trim().replace(/^[`*]|[`*]$/g, "");
    if (idLine === taskId) {
      foundPhase = { id: mPhase[1], name: mPhase[2], body: phaseBody };
      foundTaskBlock = block.trim();
      break;
    }
  }
  if (foundTaskBlock) break;
}

if (!foundPhase || !foundTaskBlock) {
  console.log(JSON.stringify({ ok: false, prompt: "", files: [], specRefs: [], warnings: [`Task "${taskId}" not found in plan`] }));
  process.exit(0);
}

// Extract task fields
const filesLine = /\*\*Files\*\*:\s*([^\n]+)/.exec(foundTaskBlock)?.[1] || "";
const files = filesLine.split(",").map((f) => f.trim().replace(/^[`*]|[`*]$/g, "")).filter(Boolean);

const specRefsLine = /\*\*Spec refs\*\*:\s*([^\n]+)/.exec(foundTaskBlock)?.[1] || "";
const specRefs = specRefsLine.split(",").map((s) => s.trim()).filter(Boolean);

// Resolve spec refs: extract <spec> block and pull named children
const specBlock = /<spec>([\s\S]*?)<\/spec>/.exec(foundPhase.body)?.[1] || "";
let specContractsSection = "";
if (specBlock.trim()) {
  if (specRefs.length === 0) {
    // No refs → include full spec
    specContractsSection = `## Spec Contracts\n\n${specBlock.trim()}\n`;
  } else {
    const matched: string[] = [];
    for (const ref of specRefs) {
      // Match any element with name="<ref>"
      const elRe = new RegExp(`<(\\w+)([^>]*\\s)?name="${ref.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"[^>]*?>([\\s\\S]*?)</\\1>|<(\\w+)([^>]*\\s)?name="${ref}"[^/]*/>`, "g");
      const lookup = new RegExp(`<(\\w+)([^>]*?)\\sname="${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)</\\1>`);
      const selfClose = new RegExp(`<(\\w+)[^>]*?\\sname="${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*?/>`);
      const selfMatch = selfClose.exec(specBlock);
      const blockMatch = lookup.exec(specBlock);
      if (blockMatch) matched.push(blockMatch[0]);
      else if (selfMatch) matched.push(selfMatch[0]);
    }
    if (matched.length > 0) {
      specContractsSection = `## Spec Contracts\n\n${matched.join("\n\n")}\n`;
    }
  }
}

// Filter gotchas to ones that touch any file in `files` or are semantically related
let gotchasSection = "";
if (existsSync(gotchasPath)) {
  const gotchasContent = readFileSync(gotchasPath, "utf-8");
  const lines = gotchasContent.split("\n");
  const matched: string[] = [];
  for (const line of lines) {
    if (!line.trim().startsWith("- ")) continue;
    // Match any of the task's files in the entry's `file:line` reference
    for (const f of files) {
      // Strip absolute prefix to get bare filename (last segment) and check substring
      const bare = f.split("/").pop() || f;
      if (line.includes(f) || (bare.length > 3 && line.includes(bare))) {
        matched.push(line);
        break;
      }
    }
  }
  if (matched.length > 0) {
    gotchasSection = `## Gotchas\n\n${matched.join("\n")}\n`;
  }
}

// Compose prompt body
const promptParts = [`### Task\n\n${foundTaskBlock}`];
if (specContractsSection) promptParts.push(specContractsSection);
if (gotchasSection) promptParts.push(gotchasSection);

const prompt = promptParts.join("\n\n");

console.log(JSON.stringify({
  ok: true,
  prompt,
  files,
  specRefs,
  phaseId: foundPhase.id,
  warnings: [],
}));
