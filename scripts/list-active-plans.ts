/**
 * list-active-plans.ts — Enumerates devorch worktrees with in-progress plans.
 * Used by Stage 0 (--resume) to pick a session to continue.
 *
 * Usage: bun ~/.claude/devorch-scripts/list-active-plans.ts [project-dir]
 * Output: JSON {count, plans: [{worktree, planPath, planTitle, donePhases, totalPhases}]}
 *
 * "In-progress" = at least one <phase> in the plan still missing status="done".
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const cwd = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const worktreesDir = join(cwd, ".worktrees");

interface PlanEntry {
  worktree: string;
  planPath: string;
  planTitle: string;
  donePhases: number;
  totalPhases: number;
}

const plans: PlanEntry[] = [];

if (existsSync(worktreesDir) && statSync(worktreesDir).isDirectory()) {
  for (const wtName of readdirSync(worktreesDir)) {
    const wtPath = join(worktreesDir, wtName);
    if (!statSync(wtPath).isDirectory()) continue;

    const plansDir = join(wtPath, ".devorch", "plans");
    if (!existsSync(plansDir)) continue;

    let planFile: string | undefined;
    try {
      planFile = readdirSync(plansDir).find((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    if (!planFile) continue;

    const planPath = join(plansDir, planFile);
    let content: string;
    try {
      content = readFileSync(planPath, "utf-8");
    } catch {
      continue;
    }

    const titleMatch = content.match(/^#\s+Plan:\s+(.+)$/m);
    const planTitle = titleMatch ? titleMatch[1].trim() : planFile.replace(/\.md$/, "");

    const totalMatches = content.match(/<phase\s+id="[^"]+"/g) || [];
    const doneMatches = content.match(/<phase\s+id="[^"]+"[^>]*\sstatus="done"/g) || [];
    const totalPhases = totalMatches.length;
    const donePhases = doneMatches.length;

    if (totalPhases === 0 || donePhases >= totalPhases) continue;

    plans.push({
      worktree: wtName,
      planPath: planPath.replaceAll("\\", "/"),
      planTitle,
      donePhases,
      totalPhases,
    });
  }
}

console.log(JSON.stringify({ count: plans.length, plans }));
