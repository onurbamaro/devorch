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

  // Find a .devorch project root by walking up; prefer cache/state.json, fall back to legacy state.md
  function hasDevorchState(dir: string): boolean {
    return (
      existsSync(join(dir, ".devorch", "cache", "state.json")) ||
      existsSync(join(dir, ".devorch", "state.md"))
    );
  }

  function findStateDir(start: string): string | null {
    let dir = start;
    for (let i = 0; i < 20; i++) {
      if (hasDevorchState(dir)) return dir;
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
          if (hasDevorchState(candidate)) {
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

  // Prefer JSON state; fall back to legacy markdown
  let phase = "?";
  let status = "unknown";
  let summary = "";

  const jsonStatePath = join(projectRoot, ".devorch", "cache", "state.json");
  const mdStatePath = join(projectRoot, ".devorch", "state.md");

  if (existsSync(jsonStatePath)) {
    try {
      const parsed = JSON.parse(readFileSync(jsonStatePath, "utf-8")) as {
        status?: string;
        lastPhase?: number;
        lastPhaseSummary?: string;
      };
      if (typeof parsed.lastPhase === "number") phase = String(parsed.lastPhase);
      if (parsed.status) status = parsed.status;
      if (parsed.lastPhaseSummary) summary = parsed.lastPhaseSummary.split("\n")[0]?.trim() ?? "";
    } catch {
      // malformed JSON — fall through to legacy parser below
    }
  }

  if ((phase === "?" || status === "unknown") && existsSync(mdStatePath)) {
    const stateContent = readFileSync(mdStatePath, "utf-8");
    const phaseMatch = stateContent.match(/Last completed phase:\s*(\d+)/);
    const statusMatch = stateContent.match(/Status:\s*(.+)/);
    if (phase === "?" && phaseMatch) phase = phaseMatch[1];
    if (status === "unknown" && statusMatch) status = statusMatch[1].trim();
    const summaryMatch = stateContent.match(/## Phase \d+ Summary\n([\s\S]*?)(?:\n##|$)/);
    if (!summary && summaryMatch) summary = summaryMatch[1].trim().split("\n")[0];
  }

  // Read plan title and count phases from the plan file (single read)
  let planTitle = "unknown";
  let totalPhases = "?";
  const plansDir = join(projectRoot, ".devorch", "plans");
  let planPath: string | undefined;
  try {
    const planEntries = readdirSync(plansDir);
    const planFile = planEntries.find((f) => f.endsWith(".md") && f !== "archive");
    if (planFile) {
      planPath = join(plansDir, planFile);
    }
  } catch {
    // ignore — plans dir may not exist
  }
  // Fallback to current.md for worktrees created before named plans were introduced
  if (!planPath) {
    const fallback = join(plansDir, "current.md");
    if (existsSync(fallback)) planPath = fallback;
  }
  if (planPath && existsSync(planPath)) {
    try {
      const planContent = readFileSync(planPath, "utf-8");
      const titleMatch = planContent.match(/^# Plan:\s*(.+)/m);
      if (titleMatch) {
        planTitle = titleMatch[1].trim();
      }
      const phaseMatches = planContent.match(/<phase\d+\s/g);
      if (phaseMatches) {
        totalPhases = String(phaseMatches.length);
      }
    } catch {
      // ignore — can't read plan
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
