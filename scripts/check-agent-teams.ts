/**
 * check-agent-teams.ts — Validates Agent Teams feature flag and parses team templates.
 * Usage: bun ~/.claude/devorch-scripts/check-agent-teams.ts
 * Output: JSON with {enabled, instructions?, templates}
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

interface Role {
  name: string;
  focus: string;
}

interface TeamTemplate {
  size: number;
  roles: Role[];
  model: string;
}

interface Output {
  enabled: boolean;
  instructions?: string;
  templates: Record<string, TeamTemplate>;
}

const FEATURE_FLAG = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS";

const DEFAULT_TEMPLATES: Record<string, TeamTemplate> = {
  "debug": {
    size: 4,
    roles: [
      { name: "investigator-1", focus: "Reproduce the issue and gather initial evidence" },
      { name: "investigator-2", focus: "Analyze error propagation and state corruption" },
      { name: "investigator-3", focus: "Check recent changes and regression patterns" },
      { name: "investigator-4", focus: "Explore edge cases and environmental factors" },
    ],
    model: "opus",
  },
  "review": {
    size: 4,
    roles: [
      { name: "security", focus: "Identify security vulnerabilities, injection risks, and auth issues" },
      { name: "quality", focus: "Assess code quality, maintainability, and adherence to conventions" },
      { name: "performance", focus: "Evaluate performance implications, bottlenecks, and resource usage" },
      { name: "tests", focus: "Verify test coverage, edge cases, and testing best practices" },
    ],
    model: "opus",
  },
  "explore-deep": {
    size: 4,
    roles: [
      { name: "explorer-1", focus: "Map system architecture and dependency relationships" },
      { name: "explorer-2", focus: "Analyze data flow and state management patterns" },
      { name: "explorer-3", focus: "Investigate integration points and external interfaces" },
      { name: "synthesizer", focus: "Synthesize findings into a coherent architectural overview" },
    ],
    model: "opus",
  },
  "make-plan-team": {
    size: 2,
    roles: [
      { name: "scope-explorer", focus: "Explore codebase to understand scope, dependencies, and impact" },
      { name: "risk-assessor", focus: "Identify risks, edge cases, and potential blockers" },
    ],
    model: "opus",
  },
  "check-team": {
    size: 3,
    roles: [
      { name: "security", focus: "Adversarial security review of implementation" },
      { name: "quality", focus: "Adversarial quality and correctness review" },
      { name: "performance", focus: "Adversarial performance and scalability review" },
    ],
    model: "opus",
  },
};

function checkFeatureFlag(): { enabled: boolean; instructions?: string } {
  const value = process.env[FEATURE_FLAG];
  if (value === "1") {
    return { enabled: true };
  }
  return {
    enabled: false,
    instructions: `Set ${FEATURE_FLAG}=1 in your environment or ~/.claude/settings.json env block`,
  };
}

function parseTemplatesFile(filePath: string): Record<string, TeamTemplate> | null {
  if (!existsSync(filePath)) return null;

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const templates: Record<string, TeamTemplate> = {};
  const sectionRegex = /^## (\S+)/gm;
  const sections: { name: string; start: number }[] = [];

  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push({ name: match[1], start: match.index });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const end = i + 1 < sections.length ? sections[i + 1].start : content.length;
    const block = content.slice(section.start, end);

    const sizeMatch = block.match(/^- size:\s*(\d+)/m);
    const modelMatch = block.match(/^- model:\s*(\S+)/m);

    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
    const model = modelMatch ? modelMatch[1] : "opus";

    const roles: Role[] = [];
    const rolesHeaderIndex = block.indexOf("### Roles");
    if (rolesHeaderIndex !== -1) {
      const rolesBlock = block.slice(rolesHeaderIndex);
      const roleRegex = /^- (\S+):\s*(.+)$/gm;
      let roleMatch;
      while ((roleMatch = roleRegex.exec(rolesBlock)) !== null) {
        roles.push({ name: roleMatch[1], focus: roleMatch[2].trim() });
      }
    }

    if (size > 0 && roles.length > 0) {
      templates[section.name] = { size, roles, model };
    }
  }

  return Object.keys(templates).length > 0 ? templates : null;
}

// --- Main ---
const flagResult = checkFeatureFlag();
const cwd = process.cwd();
const templatesPath = join(cwd, ".devorch", "team-templates.md");
const parsedTemplates = parseTemplatesFile(templatesPath);

const output: Output = {
  enabled: flagResult.enabled,
  templates: parsedTemplates ?? DEFAULT_TEMPLATES,
};

if (flagResult.instructions) {
  output.instructions = flagResult.instructions;
}

console.log(JSON.stringify(output, null, 2));
