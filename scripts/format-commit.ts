/**
 * format-commit.ts — Generates a deterministic phase commit message from plan goal or direct goal text.
 * Usage: bun ~/.claude/devorch-scripts/format-commit.ts --plan <path> --phase <N>
 *    OR: bun ~/.claude/devorch-scripts/format-commit.ts --goal <text> --phase <N>
 * Output: JSON {"message", "phase", "goal"}
 */
import { parseArgs } from "./lib/args";
import { extractTagContent, parsePhaseBounds, readPlan } from "./lib/plan-parser";

const MAX_GOAL_LENGTH = 50;

const args = parseArgs<{ plan: string; phase: number; goal: string }>([
  { name: "plan", type: "string" },
  { name: "phase", type: "number", required: true },
  { name: "goal", type: "string" },
]);

const planPath = args.plan;
const phaseNum = args.phase;
let goal = args.goal;

if (!goal && !planPath) {
  console.error("Usage: format-commit.ts --plan <path> --phase <N>  OR  --goal <text> --phase <N>");
  process.exit(1);
}

if (!goal) {
  const content = readPlan(planPath);
  const phases = parsePhaseBounds(content);

  const target = phases.find((p) => p.phase === phaseNum);
  if (!target) {
    console.error(`Phase ${phaseNum} not found. Available: ${phases.map((p) => p.phase).join(", ")}`);
    process.exit(1);
  }

  goal = extractTagContent(target.content, "goal") || "";

  if (!goal) {
    console.error(`Phase ${phaseNum}: no <goal> tag found.`);
    process.exit(1);
  }
}

// Truncate goal
const truncatedGoal = goal.length > MAX_GOAL_LENGTH
  ? goal.substring(0, MAX_GOAL_LENGTH) + "..."
  : goal;

const message = `phase(${phaseNum}): ${truncatedGoal}`;

console.log(JSON.stringify({ message, phase: phaseNum, goal }));
