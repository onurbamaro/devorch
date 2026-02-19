/**
 * generate-summary.ts — Generates .devorch/build-summary.md from plan, state-history, and git log.
 * Usage: bun ~/.claude/devorch-scripts/generate-summary.ts --plan <path>
 * Output: JSON {"summaryFile", "phasesCompleted", "projectCount"}
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "./lib/args";
import { extractTagContent, readPlan, extractPlanTitle, extractFileEntries } from "./lib/plan-parser";
import { safeReadFile } from "./lib/fs-utils";

interface PhaseInfo {
  num: number;
  name: string;
  goal: string;
}

interface ProjectEntry {
  name: string;
  path: string;
  fileCount: number;
}

const args = parseArgs<{ plan: string }>([
  { name: "plan", type: "string", required: true },
]);

const planPath = args.plan;
const content = readPlan(planPath);

const planDir = dirname(resolve(planPath));
const projectRoot = resolve(planDir, "../..");

// Extract plan fields
const planTitle = extractPlanTitle(content);
const objective = extractTagContent(content, "objective") || "";
const decisions = extractTagContent(content, "decisions") || "";

// Extract file blocks
const relevantBlock = extractTagContent(content, "relevant-files") || "";
const newFilesBlock = extractTagContent(content, "new-files") || "";

const newFiles = extractFileEntries(newFilesBlock);
const allRelevantFiles = extractFileEntries(relevantBlock);
const newFilePaths = new Set(newFiles.map((f) => f.path));
const modifiedFiles = allRelevantFiles.filter((f) => !newFilePaths.has(f.path));

// Extract projects from relevant-files sections
function extractProjects(block: string): ProjectEntry[] {
  const projects: ProjectEntry[] = [];
  const headerRegex = /^###\s+(.+?)\s*\(`([^`]+)`\)/gm;
  let match: RegExpExecArray | null;
  const sections: { name: string; path: string; start: number }[] = [];

  while ((match = headerRegex.exec(block)) !== null) {
    sections.push({ name: match[1], path: match[2], start: match.index });
  }

  for (let i = 0; i < sections.length; i++) {
    const sectionEnd = i + 1 < sections.length ? sections[i + 1].start : block.length;
    const sectionText = block.slice(sections[i].start, sectionEnd);
    const entries = extractFileEntries(sectionText);
    projects.push({
      name: sections[i].name,
      path: sections[i].path,
      fileCount: entries.length,
    });
  }

  return projects;
}

const projects = extractProjects(relevantBlock);

// Extract phases
function extractPhases(text: string): PhaseInfo[] {
  const phases: PhaseInfo[] = [];
  const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/gi;
  let match: RegExpExecArray | null;

  while ((match = phaseOpenRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const name = match[2];
    const startIdx = match.index;

    const closeRegex = new RegExp(`</phase${num}>`, "i");
    const closeMatch = text.slice(startIdx).match(closeRegex);
    const phaseBlock = closeMatch
      ? text.slice(startIdx, startIdx + closeMatch.index! + closeMatch[0].length)
      : text.slice(startIdx);

    const goalMatch = phaseBlock.match(/<goal>([\s\S]*?)<\/goal>/i);
    const goal = goalMatch ? goalMatch[1].trim() : "";

    phases.push({ num, name, goal });
  }

  return phases;
}

const phases = extractPhases(content);

// Read state-history
const historyContent = safeReadFile(resolve(projectRoot, ".devorch/state-history.md"));

function parsePhaseHistory(text: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!text) return map;

  const sections = text.split(/(?=## Phase\s+\d+)/);
  for (const section of sections) {
    const headerMatch = section.match(/^## Phase\s+(\d+)\s+Summary\s*\n([\s\S]*)/);
    if (headerMatch) {
      const num = parseInt(headerMatch[1], 10);
      map.set(num, headerMatch[2].trim());
    }
  }
  return map;
}

const phaseHistory = parsePhaseHistory(historyContent);

// Git log
function getGitLog(): string {
  try {
    const proc = Bun.spawnSync(["git", "log", "--oneline", "-20"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) return "(git not available)";
    const output = proc.stdout.toString("utf-8").trim();
    if (!output) return "(no commits found)";

    const commitPattern = /^[a-f0-9]+\s+(phase\(|feat\(|fix\(|refactor\(|chore\(devorch\):\s*plan)/;
    const filtered = output
      .split("\n")
      .filter((line) => commitPattern.test(line.trim()));

    return filtered.length > 0 ? filtered.join("\n") : "(no matching commits)";
  } catch {
    return "(git not available)";
  }
}

const commits = getGitLog();

// --- Build summary ---
const parts: string[] = [];

parts.push(`# Build Summary: ${planTitle}`);
parts.push(`Completed: ${new Date().toISOString()}`);
parts.push("");

parts.push("## Objective");
parts.push(objective || "(no objective defined)");
parts.push("");

parts.push("## Key Decisions");
parts.push(decisions || "(no decisions recorded)");
parts.push("");

if (projects.length > 0) {
  parts.push("## Projects");
  for (const proj of projects) {
    parts.push(`- \`${proj.path}\` (${proj.name}) — ${proj.fileCount} files`);
  }
  parts.push("");
}

if (newFiles.length > 0) {
  parts.push("## New Files");
  for (const f of newFiles) {
    parts.push(`- \`${f.path}\` — ${f.description}`);
  }
  parts.push("");
}

if (modifiedFiles.length > 0) {
  parts.push("## Modified Files");
  for (const f of modifiedFiles) {
    parts.push(`- \`${f.path}\` — ${f.description}`);
  }
  parts.push("");
}

parts.push("## Phase History");
if (phases.length > 0) {
  for (const phase of phases) {
    parts.push(`### Phase ${phase.num}: ${phase.name} — ${phase.goal}`);
    const summary = phaseHistory.get(phase.num);
    parts.push(summary || "(no summary available)");
    parts.push("");
  }
} else {
  parts.push("(no phase history available)");
  parts.push("");
}

parts.push("## Commits");
parts.push(commits);
parts.push("");

const summaryContent = parts.join("\n");
const summaryPath = resolve(projectRoot, ".devorch/build-summary.md");
mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(summaryPath, summaryContent, "utf-8");

console.log(JSON.stringify({
  summaryFile: ".devorch/build-summary.md",
  phasesCompleted: phases.length,
  projectCount: projects.length,
}));
