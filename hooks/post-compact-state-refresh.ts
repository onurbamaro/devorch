/**
 * PostCompact hook — refreshes devorch state after context compaction.
 * Reads the active plan (under .devorch/plans/, not archive/) and reports
 * how many phases are marked status="done" vs total.
 *
 * Input: PostCompact event JSON on stdin (consumed but not parsed)
 * Output: structured state reminder on stdout
 * Exit: always 0 (never block on state refresh failure)
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";

try {
  await new Response(Bun.stdin.stream()).text();

  function hasActivePlan(dir: string): string | null {
    const plansDir = join(dir, ".devorch", "plans");
    if (!existsSync(plansDir)) return null;
    try {
      const entries = readdirSync(plansDir);
      const active = entries.find((f) => f.endsWith(".md"));
      return active ? join(plansDir, active) : null;
    } catch {
      return null;
    }
  }

  function findProjectRoot(start: string): { root: string; planPath: string } | null {
    let dir = start;
    for (let i = 0; i < 20; i++) {
      const planPath = hasActivePlan(dir);
      if (planPath) return { root: dir, planPath };
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  const found = findProjectRoot(process.cwd());
  if (!found) process.exit(0);

  const { planPath } = found;
  const planContent = readFileSync(planPath, "utf-8");

  const titleMatch = planContent.match(/^# Plan:\s*(.+)/m);
  const planTitle = titleMatch ? titleMatch[1].trim() : "unknown";

  const phaseMatches = planContent.match(/<phase\s+id="[^"]+"/g) || [];
  const totalPhases = phaseMatches.length;

  const doneMatches = planContent.match(/<phase\s+id="[^"]+"[^>]*\sstatus="done"/g) || [];
  const donePhases = doneMatches.length;

  const parts = [
    `[devorch state refresh] Plan: ${planTitle}`,
    `Phases ${donePhases}/${totalPhases} done`,
  ];

  console.log(parts.join(" | "));
} catch {
  // Never block on state refresh failure
}

process.exit(0);
