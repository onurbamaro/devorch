/**
 * validate-spec.ts — Mechanical validation of a /devorch idea spec directory.
 *
 * Judgment-level spec review (is the contract ambiguous? is the acceptance
 * criterion actually observable?) stays with the orchestrator. This script
 * checks only what a script can check deterministically.
 *
 * Usage: bun validate-spec.ts --dir <sessionDir>/spec
 * Output: JSON {ok, errors, warnings, contracts, repos, platform, viewports}
 *
 * Checks (errors):
 *   - spec.md exists and has >=1 `## Contract: <name>` section
 *   - every contract section contains an Acceptance marker with >=1 checklist bullet
 *   - manifest.json exists, parses, has non-empty repos[] each with name + path
 *   - each repo path exists on disk and is a git repository
 *   - platform is one of web|mobile-app|desktop-app|cli|api
 *   - models values (when present) are one of haiku|sonnet|opus|fable|grok|inherit
 *   - repo dependsOn references only declared repo names
 * Checks (warnings):
 *   - decisions.md missing
 *   - repo without `run` command (visual gate will be skipped for it)
 *   - contract references a prototype screen with no .html file
 *   - prototype screen with no baseline PNG for a required viewport
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "./lib/args";

const args = parseArgs<{ dir: string }>([{ name: "dir", type: "string", required: true }]);

const specDir = resolve(args.dir);
const errors: string[] = [];
const warnings: string[] = [];

function emit(extra: Record<string, unknown> = {}): never {
  // Dedupe: the same screen/baseline warning fires once per contract that references the screen.
  console.log(
    JSON.stringify({ ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], ...extra }),
  );
  process.exit(0);
}

if (!existsSync(specDir)) {
  errors.push(`Spec dir not found: ${specDir}`);
  emit();
}

// ---- spec.md ----
const specPath = join(specDir, "spec.md");
const contracts: { name: string; screens: string[] }[] = [];
if (!existsSync(specPath)) {
  errors.push("spec.md not found");
} else {
  const spec = readFileSync(specPath, "utf-8");
  const sections = spec.split(/^## Contract:\s*/m).slice(1);
  if (sections.length === 0) {
    errors.push("spec.md has no `## Contract: <name>` sections");
  }
  for (const section of sections) {
    const name = (section.split("\n")[0] || "").trim();
    const body = section.slice(name.length);
    const hasAcceptance = /\*\*Acceptance\*\*|### Acceptance/i.test(body);
    const hasChecklist = /^\s*-\s*\[[ x]\]/m.test(body);
    if (!hasAcceptance || !hasChecklist) {
      errors.push(`Contract '${name}': missing Acceptance section with at least one \`- [ ]\` checklist item`);
    }
    const screensLine = /\*\*Screens\*\*:\s*([^\n]+)/.exec(body)?.[1] || "";
    const screens = screensLine
      .split(",")
      .map((s) => s.trim().replace(/^`|`$/g, ""))
      .filter(Boolean);
    contracts.push({ name, screens });
  }
}

// ---- manifest.json ----
const manifestPath = join(specDir, "manifest.json");
let manifest: any = null;
if (!existsSync(manifestPath)) {
  errors.push("manifest.json not found");
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (e) {
    errors.push(`manifest.json is not valid JSON: ${e}`);
  }
}

const VALID_PLATFORMS = ["web", "mobile-app", "desktop-app", "cli", "api"];
const VALID_MODELS = ["haiku", "sonnet", "opus", "fable", "grok", "inherit"];
const VALID_VIEWPORTS = ["desktop", "tablet", "mobile"];

let repoNames: string[] = [];
if (manifest) {
  if (!Array.isArray(manifest.repos) || manifest.repos.length === 0) {
    errors.push("manifest.repos must be a non-empty array");
  } else {
    repoNames = manifest.repos.map((r: any) => r?.name).filter(Boolean);
    for (const repo of manifest.repos) {
      if (!repo?.name || !repo?.path) {
        errors.push(`manifest.repos entry missing name or path: ${JSON.stringify(repo)}`);
        continue;
      }
      const repoPath = repo.path.replace(/^~/, process.env.HOME || "~");
      if (!existsSync(repoPath)) {
        errors.push(`Repo '${repo.name}': path does not exist: ${repo.path}`);
      } else if (!existsSync(join(repoPath, ".git"))) {
        errors.push(`Repo '${repo.name}': not a git repository: ${repo.path}`);
      }
      if (!repo.run) {
        warnings.push(`Repo '${repo.name}': no 'run' command — visual gate will be skipped for this repo`);
      }
      for (const dep of repo.dependsOn || []) {
        if (!repoNames.includes(dep)) {
          errors.push(`Repo '${repo.name}': dependsOn references unknown repo '${dep}'`);
        }
      }
    }
  }

  const platform = manifest.platform || "web";
  if (!VALID_PLATFORMS.includes(platform)) {
    errors.push(`manifest.platform '${platform}' invalid — use one of: ${VALID_PLATFORMS.join(", ")}`);
  }

  for (const vp of manifest.viewports || []) {
    if (!VALID_VIEWPORTS.includes(vp)) {
      errors.push(`manifest.viewports entry '${vp}' invalid — use: ${VALID_VIEWPORTS.join(", ")}`);
    }
  }

  for (const [role, model] of Object.entries(manifest.models || {})) {
    if (!VALID_MODELS.includes(model as string)) {
      errors.push(`manifest.models.${role} = '${model}' invalid — use: ${VALID_MODELS.join(", ")}`);
    }
  }
}

// ---- decisions.md ----
if (!existsSync(join(specDir, "decisions.md"))) {
  warnings.push("decisions.md missing — build inherits zero recorded decisions; ambiguity becomes spec conflicts");
}

// ---- prototype ----
// Two media: plain HTML (prototype/<screen>.html) or design-canvas sources
// (prototype/design/<Artboard>.dc.html — PascalCase artboard stems match
// kebab screen names after stripping non-alphanumerics, e.g. CartDesktop → cart).
const protoDir = join(specDir, "prototype");
const designDir = join(protoDir, "design");
const designStems = existsSync(designDir)
  ? readdirSync(designDir)
      .filter((f) => f.endsWith(".dc.html"))
      .map((f) => f.replace(/\.dc\.html$/, "").toLowerCase().replace(/[^a-z0-9]/g, ""))
  : [];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const hasPrototype =
  (existsSync(protoDir) && readdirSync(protoDir).some((f) => f.endsWith(".html"))) ||
  designStems.length > 0;
if (hasPrototype) {
  const baselineDir = join(protoDir, "baselines");
  const baselines = existsSync(baselineDir) ? readdirSync(baselineDir) : [];
  const requiredViewports: string[] =
    manifest?.platform === "mobile-app" ? ["mobile"] : manifest?.platform === "desktop-app" ? ["desktop"] : ["desktop", "mobile"];
  for (const contract of contracts) {
    for (const screen of contract.screens) {
      const hasHtml = existsSync(join(protoDir, `${screen}.html`));
      const hasDesign = designStems.some((stem) => stem.startsWith(norm(screen)));
      if (!hasHtml && !hasDesign) {
        warnings.push(`Contract '${contract.name}': screen '${screen}' has no prototype/${screen}.html nor prototype/design/ artboard`);
        continue;
      }
      for (const vp of requiredViewports) {
        if (!baselines.includes(`${screen}.${vp}.png`)) {
          warnings.push(`Screen '${screen}': missing baseline prototype/baselines/${screen}.${vp}.png`);
        }
      }
    }
  }
}

emit({
  contracts: contracts.map((c) => c.name),
  repos: repoNames,
  platform: manifest?.platform || "web",
  viewports: manifest?.viewports || [],
  hasPrototype,
});
