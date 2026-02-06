/**
 * hash-plan.ts — Compute SHA-256 hash of plan content.
 * Usage: bun ~/.claude/devorch-scripts/hash-plan.ts --plan <path>
 * Output: JSON {"hash":"...","validated":"...|null","match":true|false}
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";

function parseArgs(): { plan: string } {
  const args = process.argv.slice(2);
  let plan = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    }
  }
  if (!plan) {
    console.error("Usage: hash-plan.ts --plan <path>");
    process.exit(1);
  }
  return { plan };
}

const { plan: planPath } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

// Extract validated hash from comment if present
const validatedMatch = content.match(/<!-- Validated: ([a-f0-9]{64}) -->/);
const validated = validatedMatch ? validatedMatch[1] : null;

// Compute hash of content excluding the validated comment line
const cleanContent = content.replace(/<!-- Validated: [a-f0-9]{64} -->\n?/, "");
const hash = createHash("sha256").update(cleanContent).digest("hex");

const match = validated !== null && validated === hash;

console.log(JSON.stringify({ hash, validated, match }));
