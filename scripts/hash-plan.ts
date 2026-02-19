/**
 * hash-plan.ts — Compute SHA-256 hash of plan content.
 * Usage: bun ~/.claude/devorch-scripts/hash-plan.ts --plan <path>
 * Output: JSON {"hash":"...","validated":"...|null","match":true|false}
 */
import { createHash } from "crypto";
import { parseArgs } from "./lib/args";
import { readPlan } from "./lib/plan-parser";

const args = parseArgs<{ plan: string }>([
  { name: "plan", type: "string", required: true },
]);

const content = readPlan(args.plan);

// Extract validated hash from comment if present
const validatedMatch = content.match(/<!-- Validated: ([a-f0-9]{64}) -->/);
const validated = validatedMatch ? validatedMatch[1] : null;

// Compute hash of content excluding the validated comment line
const cleanContent = content.replace(/<!-- Validated: [a-f0-9]{64} -->\n?/, "");
const hash = createHash("sha256").update(cleanContent).digest("hex");

const match = validated !== null && validated === hash;

console.log(JSON.stringify({ hash, validated, match }));
