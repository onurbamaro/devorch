import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type AmendResult = { already: true } | { already: false };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readSession(sessionDir: string): Record<string, unknown> | null {
  const path = join(sessionDir, "session.json");
  if (!existsSync(path)) return null;
  try {
    return asRecord(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

function specConflicts(session: Record<string, unknown>): unknown[] | null {
  return Array.isArray(session.specConflicts) ? session.specConflicts : null;
}

function matchingConflict(entries: unknown[], contract: string): Record<string, unknown> | null {
  for (const entry of entries) {
    const rec = asRecord(entry);
    if (rec && rec.contract === contract) return rec;
  }
  return null;
}

export function appendAmendment(
  sessionDir: string,
  args: { contract: string; decisionText: string },
): AmendResult {
  const session = readSession(sessionDir);
  if (!session) return { already: true };
  const entries = specConflicts(session);
  if (!entries) return { already: true };
  const conflict = matchingConflict(entries, args.contract);
  if (!conflict) return { already: true };

  const evidence = typeof conflict.evidence === "string" ? conflict.evidence : "";
  const date = new Date().toISOString().slice(0, 10);
  const block =
    `## Amendment (${date}): ${args.contract}\n` +
    `- **Conflict**: ${evidence}\n` +
    `- **Decision**: ${args.decisionText}\n`;

  const specDir = join(sessionDir, "spec");
  mkdirSync(specDir, { recursive: true });
  const decisionsPath = join(specDir, "decisions.md");
  if (existsSync(decisionsPath)) {
    const existing = readFileSync(decisionsPath, "utf-8");
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(decisionsPath, existing + prefix + block);
  } else {
    writeFileSync(decisionsPath, block);
  }
  return { already: false };
}

export function clearConflict(sessionDir: string, contract: string): AmendResult {
  const session = readSession(sessionDir);
  if (!session) return { already: true };
  const entries = specConflicts(session);
  if (!entries) return { already: true };
  if (!matchingConflict(entries, contract)) return { already: true };

  const filtered = entries.filter((entry) => {
    const rec = asRecord(entry);
    return !rec || rec.contract !== contract;
  });
  const next = { ...session, specConflicts: filtered };
  writeFileSync(join(sessionDir, "session.json"), JSON.stringify(next, null, 2) + "\n");
  return { already: false };
}
