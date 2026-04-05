/**
 * fix-migration-journal.ts — Normalizes Drizzle migration journal timestamps
 * to be monotonically increasing.
 *
 * Problem: When multiple worktrees generate migrations in parallel, the merge
 * order may not match the generation order. Drizzle only applies migrations
 * where `when > lastApplied`, so out-of-order timestamps cause silent skips.
 *
 * Usage: bun ~/.claude/devorch-scripts/fix-migration-journal.ts --root <project-root>
 *        bun ~/.claude/devorch-scripts/fix-migration-journal.ts --journal <path-to-journal>
 *
 * Output: JSON {"fixed": number, "journalPath": string, "fixes": [{tag, oldWhen, newWhen}]}
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{ root: string; journal: string }>([
  { name: "root", type: "string", required: false },
  { name: "journal", type: "string", required: false },
]);

// Resolve journal path: explicit --journal or auto-detect from --root
let journalPath = "";

if (args.journal) {
  journalPath = resolve(args.journal);
} else {
  const root = args.root || process.cwd();
  // Common Drizzle migration journal locations
  const candidates = [
    "src/server/db/migrations/meta/_journal.json",
    "drizzle/meta/_journal.json",
    "migrations/meta/_journal.json",
    "db/migrations/meta/_journal.json",
  ];
  for (const candidate of candidates) {
    const full = join(resolve(root), candidate);
    if (existsSync(full)) {
      journalPath = full;
      break;
    }
  }
}

if (!journalPath || !existsSync(journalPath)) {
  console.log(
    JSON.stringify({
      fixed: 0,
      journalPath: journalPath || "not found",
      fixes: [],
      error: "Migration journal not found",
    })
  );
  process.exit(0);
}

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const entries: JournalEntry[] = journal.entries;

const fixes: Array<{ tag: string; oldWhen: number; newWhen: number }> = [];

for (let i = 1; i < entries.length; i++) {
  if (entries[i].when <= entries[i - 1].when) {
    const oldWhen = entries[i].when;
    const newWhen = entries[i - 1].when + 1;
    entries[i].when = newWhen;
    fixes.push({ tag: entries[i].tag, oldWhen, newWhen });
  }
}

if (fixes.length > 0) {
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n");
}

console.log(
  JSON.stringify({
    fixed: fixes.length,
    journalPath,
    fixes,
  })
);
