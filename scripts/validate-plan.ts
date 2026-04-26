/**
 * validate-plan.ts — Validates plan structure (used as hook or standalone).
 * Usage: bun ~/.claude/devorch-scripts/validate-plan.ts --plan <path>
 * Output: JSON {"result":"continue"} or {"result":"block","reason":"..."}
 */
import { createHash } from "crypto";
import { parseArgs } from "./lib/args";
import { extractTagContent, extractPhaseSpec, parseSpecNames, extractSecondaryRepos, extractExploreQueries, readPlan } from "./lib/plan-parser";

const args = parseArgs<{ plan: string }>([
  { name: "plan", type: "string", required: true },
]);

const planPath = args.plan;

let content: string;
try {
  content = readPlan(planPath);
} catch {
  console.log(JSON.stringify({ result: "block", reason: `Could not read plan: ${planPath}` }));
  process.exit(0);
}

const errors: string[] = [];
const warnings: string[] = [];

// --- Required top-level tags ---
const requiredTags = [
  { pattern: /<description>[\s\S]*?<\/description>/i, name: "description" },
  { pattern: /<objective>[\s\S]*?<\/objective>/i, name: "objective" },
  { pattern: /<classification>[\s\S]*?<\/classification>/i, name: "classification" },
  { pattern: /<relevant-files>[\s\S]*?<\/relevant-files>/i, name: "relevant-files" },
];

for (const { pattern, name } of requiredTags) {
  if (!pattern.test(content)) {
    errors.push(`Missing required section: ${name}`);
  }
}

// --- Classification validation ---
const classBlock = extractTagContent(content, "classification") || "";
if (classBlock) {
  const typeMatch = classBlock.match(/Type:\s*(\S+)/i);
  if (!typeMatch) {
    errors.push("Classification: missing Type. Must be one of: feature, fix, refactor, migration, chore, enhancement, infrastructure");
  } else if (!/Type:\s*(feature|fix|refactor|migration|chore|enhancement|infrastructure)/i.test(classBlock)) {
    errors.push(`Classification: invalid Type '${typeMatch[1]}'. Must be one of: feature, fix, refactor, migration, chore, enhancement, infrastructure`);
  }
  if (!/Complexity:\s*(simple|medium|complex)/i.test(classBlock)) {
    errors.push("Classification: missing or invalid Complexity. Must be one of: simple, medium, complex");
  }
  if (!/Risk:\s*(low|medium|high)/i.test(classBlock)) {
    errors.push("Classification: missing or invalid Risk. Must be one of: low, medium, high");
  }
}

// --- Check conditional sections for medium/complex ---
const isComplex = /Complexity:\s*(medium|complex)/i.test(content);
if (isComplex) {
  if (!/<problem-statement>[\s\S]*?<\/problem-statement>/i.test(content)) {
    warnings.push("Medium/complex plan missing <problem-statement> section");
  }
  if (!/<solution-approach>[\s\S]*?<\/solution-approach>/i.test(content)) {
    warnings.push("Medium/complex plan missing <solution-approach> section");
  }
}

// --- Phase detection using open/close tags ---
interface PhaseInfo {
  num: number;
  name: string;
  content: string;
}

const phases: PhaseInfo[] = [];
const phaseOpenRegex = /<phase(\d+)\s+name="([^"]*)">/gi;
let phaseMatch: RegExpExecArray | null;

while ((phaseMatch = phaseOpenRegex.exec(content)) !== null) {
  const num = parseInt(phaseMatch[1], 10);
  const name = phaseMatch[2];
  const openEnd = phaseMatch.index + phaseMatch[0].length;
  const closeTag = new RegExp(`<\\/phase${num}>`, "i");
  const closeMatch = closeTag.exec(content.slice(openEnd));

  if (closeMatch) {
    const phaseContent = content.slice(openEnd, openEnd + closeMatch.index);
    phases.push({ num, name, content: phaseContent });
  } else {
    errors.push(`Phase ${num}: missing closing </phase${num}> tag`);
  }
}

if (phases.length === 0) {
  errors.push('No phases found (expected <phase1 name="...">...</phase1>, <phase2 name="...">..., etc.)');
} else {
  // Validate sequential numbering
  for (let i = 0; i < phases.length; i++) {
    if (phases[i].num !== i + 1) {
      errors.push(`Phase numbering not sequential: expected Phase ${i + 1}, got Phase ${phases[i].num}`);
      break;
    }
  }

  // Per-phase validation
  for (const phase of phases) {
    const phaseContent = phase.content;

    const phaseRequired = [
      { pattern: /<goal>[\s\S]*?<\/goal>/i, name: "goal" },
      { pattern: /<tasks>[\s\S]*?<\/tasks>/i, name: "tasks" },
      { pattern: /<execution>[\s\S]*?<\/execution>/i, name: "execution" },
      { pattern: /<criteria>[\s\S]*?<\/criteria>/i, name: "criteria" },
    ];

    for (const { pattern, name } of phaseRequired) {
      if (!pattern.test(phaseContent)) {
        errors.push(`Phase ${phase.num}: missing ${name} section`);
      }
    }

    // Execution wave check
    const executionContent = extractTagContent(phaseContent, "execution");
    if (executionContent) {
      if (!/\*\*Wave \d+\*\*/i.test(executionContent)) {
        warnings.push(`Phase ${phase.num}: Execution section missing Wave definitions`);
      }
    }

    // Task metadata checks
    const tasksContent = extractTagContent(phaseContent, "tasks") || "";

    const taskBlocks = tasksContent.match(/####\s+\d+\./g);
    if (taskBlocks && taskBlocks.length > 0) {
      if (!/\*\*ID\*\*:/i.test(tasksContent)) {
        warnings.push(`Phase ${phase.num}: tasks missing ID metadata`);
      }
      if (!/\*\*Assigned To\*\*:/i.test(tasksContent)) {
        warnings.push(`Phase ${phase.num}: tasks missing Assigned To metadata`);
      }
    }

    // --- Spec validation ---
    const specContent = extractPhaseSpec(phaseContent);
    if (specContent === null) {
      const typeMatch = classBlock.match(/Type:\s*(\S+)/i);
      const complexityMatch = classBlock.match(/Complexity:\s*(\S+)/i);
      const planType = typeMatch ? typeMatch[1].toLowerCase() : "";
      const planComplexity = complexityMatch ? complexityMatch[1].toLowerCase() : "";
      const promotableTypes = ["feature", "migration", "enhancement"];
      const promotableComplexities = ["medium", "complex"];
      if (promotableTypes.includes(planType) && promotableComplexities.includes(planComplexity)) {
        errors.push(`Phase ${phase.num} has no <spec> section (required for ${planType}/${planComplexity} plans)`);
      } else {
        warnings.push(`Phase ${phase.num} has no <spec> section`);
      }
    } else {
      // Structural validation for each sub-tag type
      const interfaceRegex = /<interface\s+([^>]*)>([\s\S]*?)<\/interface>/gi;
      let specMatch: RegExpExecArray | null;
      while ((specMatch = interfaceRegex.exec(specContent)) !== null) {
        const attrs = specMatch[1];
        const body = specMatch[2];
        if (!/name="[^"]+"/.test(attrs)) {
          errors.push(`Phase ${phase.num}: <interface> missing name attribute`);
        }
        if (!/<input[\s>]/i.test(body)) {
          errors.push(`Phase ${phase.num}: <interface> missing <input>`);
        }
        if (!/<output[\s>]/i.test(body)) {
          errors.push(`Phase ${phase.num}: <interface> missing <output>`);
        }
        // Quality: placeholder check
        const inputMatch = body.match(/<input[^>]*>([\s\S]*?)<\/input>/i);
        if (inputMatch && /^\s*\.{3}\s*$/.test(inputMatch[1])) {
          warnings.push(`Phase ${phase.num}: <interface> <input> is a placeholder`);
        }
        const outputMatch = body.match(/<output[^>]*>([\s\S]*?)<\/output>/i);
        if (outputMatch && /^\s*\.{3}\s*$/.test(outputMatch[1])) {
          warnings.push(`Phase ${phase.num}: <interface> <output> is a placeholder`);
        }
      }

      const ecRegex = /<error-contract\s+([^>]*)>([\s\S]*?)<\/error-contract>/gi;
      while ((specMatch = ecRegex.exec(specContent)) !== null) {
        const attrs = specMatch[1];
        const body = specMatch[2];
        if (!/name="[^"]+"/.test(attrs)) {
          errors.push(`Phase ${phase.num}: <error-contract> missing name attribute`);
        }
        const cases = body.match(/<case[\s>]/gi);
        if (!cases || cases.length === 0) {
          errors.push(`Phase ${phase.num}: <error-contract> must contain at least 1 <case>`);
        } else if (cases.length === 1) {
          warnings.push(`Phase ${phase.num}: <error-contract> has only 1 case — consider covering more`);
        }
      }

      const behaviorRegex = /<behavior\s+([^>]*)>([\s\S]*?)<\/behavior>/gi;
      while ((specMatch = behaviorRegex.exec(specContent)) !== null) {
        const attrs = specMatch[1];
        const body = specMatch[2];
        if (!/name="[^"]+"/.test(attrs)) {
          errors.push(`Phase ${phase.num}: <behavior> missing name attribute`);
        }
        if (!/<precondition[\s>]/i.test(body) && !/<postcondition[\s>]/i.test(body)) {
          errors.push(`Phase ${phase.num}: <behavior> must contain <precondition> or <postcondition>`);
        }
      }

      const invariantRegex = /<invariant(?:\s[^>]*)?>[\s\S]*?<\/invariant>/gi;
      while ((specMatch = invariantRegex.exec(specContent)) !== null) {
        const bodyText = specMatch[0].replace(/<\/?invariant[^>]*>/gi, "").trim();
        if (!bodyText) {
          errors.push(`Phase ${phase.num}: <invariant> has empty text content`);
        }
      }

      const endpointRegex = /<endpoint\s+([^>]*)>([\s\S]*?)<\/endpoint>/gi;
      while ((specMatch = endpointRegex.exec(specContent)) !== null) {
        const attrs = specMatch[1];
        const body = specMatch[2];
        if (!/path="[^"]+"/.test(attrs)) {
          errors.push(`Phase ${phase.num}: <endpoint> missing path attribute`);
        }
        if (!/method="[^"]+"/.test(attrs)) {
          errors.push(`Phase ${phase.num}: <endpoint> missing method attribute`);
        }
        if (!/<response[\s>]/i.test(body)) {
          errors.push(`Phase ${phase.num}: <endpoint> must contain at least 1 <response>`);
        }

        // Auth warning for mutating endpoints
        const methodMatch = attrs.match(/method="([^"]+)"/i);
        if (methodMatch) {
          const method = methodMatch[1].toUpperCase();
          if (/^(POST|DELETE|PATCH|PUT)$/.test(method)) {
            const requestMatch = body.match(/<request[^>]*>([\s\S]*?)<\/request>/i);
            const authKeywords = /jwt|auth|token|public|internal|network|api-key/i;
            const pathAttr = attrs.match(/path="([^"]+)"/)?.[1] || "unknown";
            if (!requestMatch) {
              warnings.push(`Phase ${phase.num}: mutating endpoint ${method} ${pathAttr} has no <request> — consider specifying auth requirements`);
            } else if (!authKeywords.test(requestMatch[1])) {
              warnings.push(`Phase ${phase.num}: mutating endpoint ${method} ${pathAttr} <request> has no auth annotation — consider specifying auth requirements`);
            }
          }
        }
      }

      // Entity validation
      const entityRegex = /<entity\s+([^>]*)>([\s\S]*?)<\/entity>/gi;
      while ((specMatch = entityRegex.exec(specContent)) !== null) {
        const attrs = specMatch[1];
        const body = specMatch[2];
        const entityNameMatch = attrs.match(/name="([^"]+)"/);
        if (!entityNameMatch) {
          errors.push(`Phase ${phase.num}: <entity> missing name attribute`);
        }
        const entityLabel = entityNameMatch ? entityNameMatch[1] : "unknown";

        // Count children: field, relationship, constraint
        const fields = [...body.matchAll(/<field\s+([^>]*)\/?>/gi)];
        const relationships = [...body.matchAll(/<relationship\s+([^>]*)\/?>/gi)];
        const constraints = [...body.matchAll(/<constraint(?:\s[^>]*)?>[\s\S]*?<\/constraint>/gi)];

        if (fields.length + relationships.length + constraints.length === 0) {
          errors.push(`Phase ${phase.num}: <entity> '${entityLabel}' has no children (needs field, relationship, or constraint)`);
        }

        for (const field of fields) {
          if (!/name="[^"]+"/.test(field[1])) {
            errors.push(`Phase ${phase.num}: <entity> '${entityLabel}' has <field> missing name attribute`);
          }
        }

        for (const rel of relationships) {
          if (!/target="[^"]+"/.test(rel[1])) {
            errors.push(`Phase ${phase.num}: <entity> '${entityLabel}' has <relationship> missing target attribute`);
          }
        }

        for (const con of constraints) {
          const conBody = con[0].replace(/<\/?constraint[^>]*>/gi, "").trim();
          if (!conBody) {
            errors.push(`Phase ${phase.num}: <entity> '${entityLabel}' has <constraint> with empty body`);
          }
        }
      }

      // Uniqueness: all spec names within a phase must be unique
      const specNames = parseSpecNames(specContent);
      const seen = new Set<string>();
      for (const name of specNames) {
        if (seen.has(name)) {
          errors.push(`Phase ${phase.num}: duplicate spec name "${name}"`);
        }
        seen.add(name);
      }

      // Ref integrity: tasks referencing specs that don't exist
      const specNamesSet = new Set(specNames);
      const taskSectionsForRefs = tasksContent.split(/####\s+\d+\.\s+/);
      for (const section of taskSectionsForRefs.slice(1)) {
        const taskIdMatch = section.match(/\*\*ID\*\*:\s*(\S+)/i);
        const refsMatch = section.match(/\*\*Spec refs\*\*:\s*(.+)/i);
        if (refsMatch) {
          const refNames = refsMatch[1].split(",").map((r) => r.trim()).filter(Boolean);
          for (const ref of refNames) {
            if (!specNamesSet.has(ref)) {
              const tid = taskIdMatch ? taskIdMatch[1] : "unknown";
              const availableSpecs = Array.from(specNamesSet).join(", ");
              if (availableSpecs.length === 0) {
                errors.push(`Task ${tid} references spec '${ref}' which is not defined. No specs defined in phase ${phase.num}; either define one or remove the Spec ref.`);
              } else {
                errors.push(`Task ${tid} references spec '${ref}' which is not defined. Available specs in phase ${phase.num}: ${availableSpecs}`);
              }
            }
          }
        }
      }

    }

    // --- Assigned To validation (single builder: devorch-builder) ---
    const taskSectionsForME = tasksContent.split(/####\s+\d+\.\s+/);
    for (const section of taskSectionsForME.slice(1)) {
      const taskIdMatchME = section.match(/\*\*ID\*\*:\s*(\S+)/i);
      const tid = taskIdMatchME ? taskIdMatchME[1] : "unknown";

      const assignedMatch = section.match(/\*\*Assigned To\*\*:\s*(\S+)/i);
      if (assignedMatch && assignedMatch[1] !== "devorch-builder") {
        warnings.push(`Phase ${phase.num}: task "${tid}" has unrecognized Assigned To "${assignedMatch[1]}" (expected: devorch-builder)`);
      }

      const exemplarsMatch = section.match(/^\s*\*\*Exemplars\*\*:\s*(.+)$/im);
      if (exemplarsMatch && !exemplarsMatch[1].trim()) {
        warnings.push(`Phase ${phase.num}: task "${tid}" has empty Exemplars field — omit the line or provide paths`);
      }

      const nonGoalsMatch = section.match(/^\s*\*\*Non-goals\*\*:\s*(.+)$/im);
      if (nonGoalsMatch && !nonGoalsMatch[1].trim()) {
        warnings.push(`Phase ${phase.num}: task "${tid}" has empty Non-goals field — omit the line or provide a description`);
      }
    }

    // Handoff — required except last phase
    if (phase.num < phases.length) {
      if (!/<handoff>[\s\S]*?<\/handoff>/i.test(phaseContent)) {
        warnings.push(`Phase ${phase.num}: missing <handoff> section`);
      }
    }

    // --- Wave conflict detection ---
    interface TaskFileInfo {
      id: string;
      files: string[];
      repo: string;
    }

    const tasks: TaskFileInfo[] = [];
    const taskSections = tasksContent.split(/####\s+\d+\.\s+/);

    for (const section of taskSections.slice(1)) {
      const idMatch = section.match(/\*\*ID\*\*:\s*(\S+)/i);
      if (!idMatch) continue;

      const taskId = idMatch[1];
      const fileRefs = [...section.matchAll(/`([^`]*(?:\/[^`]+|\.\w{1,5}))`/g)]
        .map((m) => m[1])
        .filter((f) => /\.\w{1,5}$/.test(f));

      const repoMatch = section.match(/\*\*Repo\*\*:\s*(\S+)/i);
      const repo = repoMatch ? repoMatch[1] : "primary";

      tasks.push({ id: taskId, files: fileRefs, repo });
    }

    // --- Explore queries validation (optional section) ---
    const exploreQueries = extractExploreQueries(phaseContent);
    if (exploreQueries.length > 0) {
      const phaseTaskIds = tasks.map((t) => t.id);
      const seenQueries = new Set<string>();

      for (const eq of exploreQueries) {
        if (!eq.query) {
          warnings.push(`Phase ${phase.num}: <explore-queries> has an empty query text`);
        }
        if (!phaseTaskIds.includes(eq.taskId)) {
          warnings.push(`Phase ${phase.num}: <explore-queries> references unknown task-id "${eq.taskId}"`);
        }
        if (seenQueries.has(eq.query)) {
          warnings.push(`Phase ${phase.num}: <explore-queries> has duplicate query "${eq.query}"`);
        }
        seenQueries.add(eq.query);
      }
    }

    const executionBlock = extractTagContent(phaseContent, "execution") || "";
    const waveRegex = /\*\*Wave\s+(\d+)\*\*[^:]*:\s*(.+)/gi;
    const waveMatches = [...executionBlock.matchAll(waveRegex)];

    for (const waveMatch of waveMatches) {
      const waveNum = waveMatch[1];
      const taskIds = waveMatch[2]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      for (const tid of taskIds) {
        if (!tasks.some((t) => t.id === tid)) {
          warnings.push(
            `Phase ${phase.num}: Wave ${waveNum} references unknown task ID "${tid}"`
          );
        }
      }

      const waveTasks = tasks.filter((t) => taskIds.includes(t.id));
      for (let a = 0; a < waveTasks.length; a++) {
        for (let b = a + 1; b < waveTasks.length; b++) {
          const overlap = waveTasks[a].files.filter((f) =>
            waveTasks[b].files.includes(f)
          );
          if (overlap.length > 0) {
            warnings.push(
              `Phase ${phase.num}: Wave ${waveNum} conflict — tasks "${waveTasks[a].id}" and "${waveTasks[b].id}" both touch: ${overlap.join(", ")}`
            );
          }
        }
      }

      // Same-Repo wave check: 2+ tasks targeting the same repo within a wave
      // would force builders to share a worktree, exposing each other's WIP
      // during typecheck/lint. Hard error.
      const repoGroups = new Map<string, string[]>();
      for (const wt of waveTasks) {
        const repoKey = wt.repo || "primary";
        const list = repoGroups.get(repoKey) ?? [];
        list.push(wt.id);
        repoGroups.set(repoKey, list);
      }
      for (const [repoName, ids] of repoGroups) {
        if (ids.length >= 2) {
          errors.push(
            `Wave ${waveNum} in phase ${phase.num} has 2+ tasks targeting Repo "${repoName}": [${ids.join(", ")}]. Builders sharing a worktree see each other's WIP during typecheck/lint — split into separate \`## Execution\` waves in the plan and re-validate.`
          );
        }
      }
    }
  }
}

// --- Semantic warnings: cross-reference relevant-files with spec coverage ---
const relevantFilesContent = extractTagContent(content, "relevant-files") || "";
if (relevantFilesContent && phases.length > 0) {
  const hasEntitySpec = phases.some((p) => {
    const spec = extractPhaseSpec(p.content);
    return spec ? /<entity\s/i.test(spec) : false;
  });
  const hasEndpointSpec = phases.some((p) => {
    const spec = extractPhaseSpec(p.content);
    return spec ? /<endpoint\s/i.test(spec) : false;
  });

  const schemaPatterns = /schema|migration|\.sql|db\/schema/i;
  if (schemaPatterns.test(relevantFilesContent) && !hasEntitySpec) {
    warnings.push("Relevant files reference schema/migration paths but no <entity> spec found in any phase");
  }

  const routePatterns = /\/routes\/|\/handlers\/|\/api\/|\/endpoints\//i;
  if (routePatterns.test(relevantFilesContent) && !hasEndpointSpec) {
    warnings.push("Relevant files reference route/handler/API paths but no <endpoint> spec found in any phase");
  }
}

// --- Secondary repos validation ---
const secondaryRepos = extractSecondaryRepos(content);

if (secondaryRepos.length > 0) {
  // Unique names
  const repoNames = secondaryRepos.map((r) => r.name);
  const uniqueNames = new Set(repoNames);
  if (uniqueNames.size !== repoNames.length) {
    const dupes = repoNames.filter((n, i) => repoNames.indexOf(n) !== i);
    errors.push(`Secondary repos: duplicate names: ${[...new Set(dupes)].join(", ")}`);
  }

  // Reserved name "primary"
  for (const repo of secondaryRepos) {
    if (repo.name.toLowerCase() === "primary") {
      errors.push(`Secondary repos: name "primary" is reserved`);
    }
  }

  // Duplicate paths
  const repoPaths = secondaryRepos.map((r) => r.path);
  const uniquePaths = new Set(repoPaths);
  if (uniquePaths.size !== repoPaths.length) {
    const dupes = repoPaths.filter((p, i) => repoPaths.indexOf(p) !== i);
    errors.push(`Secondary repos: duplicate paths: ${[...new Set(dupes)].join(", ")}`);
  }

  // Path validation (warning only)
  for (const repo of secondaryRepos) {
    if (/^[A-Z]:\\|^\//.test(repo.path)) {
      warnings.push(`Secondary repos: "${repo.name}" has absolute path "${repo.path}" — expected relative`);
    }
    if (/\s/.test(repo.path)) {
      warnings.push(`Secondary repos: "${repo.name}" path contains whitespace`);
    }
  }

  // Validate **Repo** references in tasks across all phases
  const validRepoNames = new Set(repoNames);
  for (const phase of phases) {
    const tasksContent = extractTagContent(phase.content, "tasks") || "";
    const taskSections = tasksContent.split(/####\s+\d+\.\s+/);

    for (const section of taskSections.slice(1)) {
      const idMatch = section.match(/\*\*ID\*\*:\s*(\S+)/i);
      const repoMatch = section.match(/\*\*Repo\*\*:\s*(\S+)/i);
      if (repoMatch) {
        const repoName = repoMatch[1];
        if (repoName.toLowerCase() !== "primary" && !validRepoNames.has(repoName)) {
          const taskId = idMatch ? idMatch[1] : "unknown";
          errors.push(
            `Phase ${phase.num}: task "${taskId}" references unknown repo "${repoName}"`
          );
        }
      }
    }
  }
}

// --- Output ---
if (errors.length === 0) {
  const cleanContent = content.replace(/<!-- Validated: [a-f0-9]{64} -->\n?/, "");
  const hash = createHash("sha256").update(cleanContent).digest("hex");

  const result: { result: string; hash: string; warnings?: string[] } = { result: "continue", hash };
  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  console.log(JSON.stringify(result));
} else {
  const reason = errors.join("; ");
  const result: { result: string; reason: string; warnings?: string[] } = { result: "block", reason };
  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  console.log(JSON.stringify(result));
}
