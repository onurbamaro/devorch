/**
 * slice-builder.ts — Wave/task parsing and slice-size gate constants for init-phase.
 */
import { extractTagContent } from "./plan-parser";

export interface ParsedWave {
  wave: number;
  taskIds: string[];
  type: "parallel" | "sequential";
}

export interface ParsedTask {
  id: string;
  assignedTo: string;
  repo: string;
  title: string;
  content: string;
  model?: string;
  effort?: string;
  exemplars: string[];
  nonGoals: string;
}

/** Token-gate thresholds for per-task slice-size warnings (Principle 2).
 *  `< TOKEN_GATE_UNDER` → task is likely under-contextualized.
 *  `> TOKEN_GATE_OVER`  → curation failed; builder is back on bulk context. */
export const TOKEN_GATE_UNDER = 3000;
export const TOKEN_GATE_OVER = 30000;

/**
 * Parse the phase's `<execution>` block into wave descriptors. Recognizes lines
 * of the shape `**Wave N** (parallel|sequential): id-a, id-b, …`. The annotation
 * defaults to `parallel` when omitted; `sequential` is the only other accepted
 * value (any other annotation is treated as `parallel`).
 */
export function parseWaves(phaseText: string): ParsedWave[] {
  const executionContent = extractTagContent(phaseText, "execution");
  if (!executionContent) return [];

  const waves: ParsedWave[] = [];
  const waveRegex = /\*\*Wave\s+(\d+)\*\*\s*(?:\(([^)]*)\))?\s*:\s*(.+)/gi;
  let waveMatch: RegExpExecArray | null;

  while ((waveMatch = waveRegex.exec(executionContent)) !== null) {
    const waveNum = parseInt(waveMatch[1], 10);
    const annotation = (waveMatch[2] || "").trim().toLowerCase();
    const taskIdStr = waveMatch[3];

    let type: "parallel" | "sequential" = "parallel";
    if (annotation === "sequential") {
      type = "sequential";
    }

    const taskIds = taskIdStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    waves.push({ wave: waveNum, taskIds, type });
  }

  return waves;
}

/**
 * Parse the phase's `<tasks>` block into a map of task-id → task descriptor.
 * Each task is delimited by `#### N. Title` and carries `**ID**`, `**Assigned
 * To**`, `**Repo**`, optional `**Model**` / `**Effort**`, `**Exemplars**`, and
 * `**Non-goals**` markdown fields. Tasks missing an `**ID**` field are skipped.
 */
export function parseTasks(phaseText: string): Record<string, ParsedTask> {
  const tasksContent = extractTagContent(phaseText, "tasks") || "";
  const tasks: Record<string, ParsedTask> = {};

  const taskHeaderRegex = /^####\s+\d+\.\s+/m;
  const taskSections = tasksContent.split(taskHeaderRegex);
  const taskHeaders = [...tasksContent.matchAll(/^####\s+\d+\.\s+(.+)$/gm)];

  for (let i = 0; i < taskHeaders.length; i++) {
    const title = taskHeaders[i][1].trim();
    const sectionContent = taskSections[i + 1] || "";

    const idMatch = sectionContent.match(/\*\*ID\*\*:\s*(\S+)/i);
    const id = idMatch ? idMatch[1] : "";

    const assignedMatch = sectionContent.match(/\*\*Assigned To\*\*:\s*(\S+)/i);
    const assignedTo = assignedMatch ? assignedMatch[1] : "";

    const repoMatch = sectionContent.match(/\*\*Repo\*\*:\s*(\S+)/i);
    const repo = repoMatch ? repoMatch[1] : "primary";

    const modelMatch = sectionContent.match(/\*\*Model\*\*:\s*(\S+)/i);
    const model = modelMatch ? modelMatch[1].toLowerCase() : undefined;

    const effortMatch = sectionContent.match(/\*\*Effort\*\*:\s*(\S+)/i);
    const effort = effortMatch ? effortMatch[1].toLowerCase() : undefined;

    const exemplarsMatch = sectionContent.match(/^\s*\*\*Exemplars\*\*:\s*(.+)$/im);
    const exemplars = exemplarsMatch
      ? exemplarsMatch[1].split(",").map((e) => e.trim()).filter(Boolean)
      : [];

    const nonGoalsMatch = sectionContent.match(/^\s*\*\*Non-goals\*\*:\s*(.+)$/im);
    const nonGoals = nonGoalsMatch ? nonGoalsMatch[1].trim() : "";

    const fullContent = `#### ${taskHeaders[i][0].match(/\d+/)?.[0] || i + 1}. ${title}\n${sectionContent.trimEnd()}`;

    if (id) {
      const task: ParsedTask = { id, assignedTo, repo, title, content: fullContent, exemplars, nonGoals };
      if (model) task.model = model;
      if (effort) task.effort = effort;
      tasks[id] = task;
    }
  }

  return tasks;
}
