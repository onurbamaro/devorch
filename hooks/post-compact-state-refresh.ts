/**
 * PostCompact hook — refreshes devorch state after context compaction.
 * Outputs a structured reminder of current plan progress so the agent
 * retains awareness of where it is in the build pipeline.
 *
 * Input: PostCompact event JSON on stdin (includes compact_summary)
 * Output: structured state reminder on stdout
 * Exit: always 0 (never block on state refresh failure)
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";

try {
  // Read stdin (PostCompact provides compact_summary)
  const input = await new Response(Bun.stdin.stream()).text();
  // We don't need to parse the input — just consume it

  // Find .devorch/state.md by walking up from cwd
  function findStateDir(start: string): string | null {
    let dir = start;
    for (let i = 0; i < 20; i++) {
      const statePath = join(dir, ".devorch", "state.md");
      if (existsSync(statePath)) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  let projectRoot = findStateDir(process.cwd());

  // If not found, check .worktrees/*/ subdirectories
  if (!projectRoot) {
    const cwd = process.cwd();
    const worktreesDir = join(cwd, ".worktrees");
    if (existsSync(worktreesDir)) {
      try {
        const entries = readdirSync(worktreesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const candidate = join(worktreesDir, entry.name);
          const statePath = join(candidate, ".devorch", "state.md");
          if (existsSync(statePath)) {
            projectRoot = candidate;
            break;
          }
        }
      } catch {
        // ignore — can't read worktrees dir
      }
    }
  }

  if (!projectRoot) {
    process.exit(0);
  }

  const statePath = join(projectRoot, ".devorch", "state.md");
  const stateContent = readFileSync(statePath, "utf-8");

  // Extract phase info from state.md
  const phaseMatch = stateContent.match(/Last completed phase:\s*(\d+)/);
  const statusMatch = stateContent.match(/Status:\s*(.+)/);
  const phase = phaseMatch ? phaseMatch[1] : "?";
  const status = statusMatch ? statusMatch[1].trim() : "unknown";

  // Extract handoff/summary
  const summaryMatch = stateContent.match(/## Phase \d+ Summary\n([\s\S]*?)(?:\n##|$)/);
  const summary = summaryMatch ? summaryMatch[1].trim().split("\n")[0] : "";

  // Read plan title from current.md
  let planTitle = "unknown";
  const planPath = join(projectRoot, ".devorch", "plans", "current.md");
  if (existsSync(planPath)) {
    try {
      const planContent = readFileSync(planPath, "utf-8");
      const titleMatch = planContent.match(/^# Plan:\s*(.+)/m);
      if (titleMatch) {
        planTitle = titleMatch[1].trim();
      }
    } catch {
      // ignore — can't read plan
    }
  }

  // Count total phases from plan
  let totalPhases = "?";
  if (existsSync(planPath)) {
    try {
      const planContent = readFileSync(planPath, "utf-8");
      const phaseMatches = planContent.match(/<phase\d+\s/g);
      if (phaseMatches) {
        totalPhases = String(phaseMatches.length);
      }
    } catch {
      // ignore
    }
  }

  const parts = [
    `[devorch state refresh] Plan: ${planTitle}`,
    `Phase ${phase}/${totalPhases} complete`,
    `Status: ${status}`,
  ];

  if (summary) {
    parts.push(`Last handoff: ${summary}`);
  }

  console.log(parts.join(" | "));
} catch {
  // Never block on state refresh failure
}

process.exit(0);
