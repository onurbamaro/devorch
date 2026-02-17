/**
 * generate-summary.ts — Generates .devorch/build-summary.md from plan, state-history, and git log.
 * Usage: bun ~/.claude/devorch-scripts/generate-summary.ts --plan <path>
 * Output: JSON {"summaryFile", "phasesCompleted", "projectCount"}
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

function parseArgs(): { plan: string } {
  const args = process.argv.slice(2);
  let plan = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    }
  }
  if (!plan) {
    console.error("Usage: generate-summary.ts --plan <path>");
    process.exit(1);
  }
  return { plan };
}

function extractTagContent(text: string, tagName: string): string {
  const match = text.match(new RegExp(`^\\s*<${tagName}>([\\s\\S]*?)^\\s*<\\/${tagName}>`, "im"));
  return match ? match[1].trim() : "";
}

function safeReadFile(filePath: string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8");
    }
  } catch {
    // ignore — optional file
  }
  return "";
}

interface PhaseInfo {
  num: number;
  name: string;
  goal: string;
}

interface FileEntry {
  path: string;
  description: string;
}

interface ProjectEntry {
  name: string;
  path: string;
  fileCount: number;
}

function extractPhases(content: string): PhaseInfo[] {
  const phases: PhaseInfo[] = [];
  const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/gi;
  let match: RegExpExecArray | null;

  while ((match = phaseOpenRegex.exec(content)) !== null) {
    const num = parseInt(match[1], 10);
    const name = match[2];
    const startIdx = match.index;

    const closeRegex = new RegExp(`</phase${num}>`, "i");
    const closeMatch = content.slice(startIdx).match(closeRegex);
    const phaseBlock = closeMatch
      ? content.slice(startIdx, startIdx + closeMatch.index! + closeMatch[0].length)
      : content.slice(startIdx);

    const goalMatch = phaseBlock.match(/<goal>([\s\S]*?)<\/goal>/i);
    const goal = goalMatch ? goalMatch[1].trim() : "";

    phases.push({ num, name, goal });
  }

  return phases;
}

function extractFileEntries(block: string): FileEntry[] {
  const files: FileEntry[] = [];
  const lines = block.split("\n");
  for (const line of lines) {
    const fileMatch = line.match(/^[-*]\s*`([^`]+)`\s*(?:—|--|-)\s*(.*)/);
    if (fileMatch) {
      files.push({ path: fileMatch[1], description: fileMatch[2].trim() });
    }
  }
  return files;
}

function extractProjects(relevantBlock: string): ProjectEntry[] {
  const projects: ProjectEntry[] = [];
  const headerRegex = /^###\s+(.+?)\s*\(`([^`]+)`\)/gm;
  let match: RegExpExecArray | null;
  const sections: { name: string; path: string; start: number }[] = [];

  while ((match = headerRegex.exec(relevantBlock)) !== null) {
    sections.push({ name: match[1], path: match[2], start: match.index });
  }

  for (let i = 0; i < sections.length; i++) {
    const sectionEnd = i + 1 < sections.length ? sections[i + 1].start : relevantBlock.length;
    const sectionText = relevantBlock.slice(sections[i].start, sectionEnd);
    const fileEntries = extractFileEntries(sectionText);
    projects.push({
      name: sections[i].name,
      path: sections[i].path,
      fileCount: fileEntries.length,
    });
  }

  return projects;
}

function parsePhaseHistory(historyContent: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!historyContent) return map;

  const sections = historyContent.split(/(?=## Phase\s+\d+)/);
  for (const section of sections) {
    const headerMatch = section.match(/^## Phase\s+(\d+)\s+Summary\s*\n([\s\S]*)/);
    if (headerMatch) {
      const num = parseInt(headerMatch[1], 10);
      map.set(num, headerMatch[2].trim());
    }
  }
  return map;
}

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

// --- Main ---
const { plan: planPath } = parseArgs();

let content: string;
try {
  content = readFileSync(planPath, "utf-8");
} catch {
  console.error(`Could not read plan: ${planPath}`);
  process.exit(1);
}

const planDir = dirname(resolve(planPath));
const projectRoot = resolve(planDir, "../..");

// Extract plan fields
const titleMatch = content.match(/^#\s+Plan:\s+(.+)$/m);
const planTitle = titleMatch ? titleMatch[1].trim() : "Untitled Plan";
const objective = extractTagContent(content, "objective");
const decisions = extractTagContent(content, "decisions");

// Extract file blocks
const relevantBlock = extractTagContent(content, "relevant-files");
const newFilesBlock = extractTagContent(content, "new-files");

const projects = extractProjects(relevantBlock);
const newFiles = extractFileEntries(newFilesBlock);

// Extract modified files (relevant-files minus new-files, at root level)
const newFilePaths = new Set(newFiles.map((f) => f.path));
const allRelevantFiles = extractFileEntries(relevantBlock);
const modifiedFiles = allRelevantFiles.filter((f) => !newFilePaths.has(f.path));

// Extract phases
const phases = extractPhases(content);

// Read state-history
const historyContent = safeReadFile(resolve(projectRoot, ".devorch/state-history.md"));
const phaseHistory = parsePhaseHistory(historyContent);

// Git log
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
