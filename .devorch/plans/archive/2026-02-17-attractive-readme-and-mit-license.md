# Plan: Attractive README and MIT License

<description>
Rewrite README.md with a marketing-friendly tone optimized for both humans and LLMs, and add MIT license to the project.
</description>

<objective>
README.md is rewritten with compelling copy, clear value proposition, structured LLM-friendly metadata section, and professional formatting. LICENSE file exists with MIT license. package.json includes the license field.
</objective>

<classification>
Type: chore
Complexity: simple
Risk: low
</classification>

<decisions>
License type → MIT
README language → English
README tone → Marketing-friendly (persuasive, highlights benefits, clear value proposition)
LLM section → Yes, include a structured metadata block optimized for AI agents to parse
</decisions>

<relevant-files>
- `README.md` — Complete rewrite with marketing tone, LLM-friendly section, professional formatting
- `package.json` — Add `license: "MIT"` field

<new-files>
- `LICENSE` — MIT license file with current year and author
</new-files>
</relevant-files>

<phase1 name="README Rewrite and License">
<goal>Rewrite README.md with marketing-friendly tone and LLM-friendly metadata, create MIT LICENSE file, update package.json license field.</goal>

<tasks>
#### 1. Create MIT License and Update package.json
- **ID**: create-license
- **Assigned To**: builder-1
- Create `LICENSE` file in project root with MIT license text, year 2026, author "Bruno" (from git config or use project convention)
- Add `"license": "MIT"` field to `package.json`

#### 2. Rewrite README with Marketing Tone and LLM Section
- **ID**: rewrite-readme
- **Assigned To**: builder-2
- Rewrite `README.md` completely with these sections and guidelines:
  - **Hero section**: Bold project name, one-liner value prop ("Ship features 10x faster with multi-agent orchestration for Claude Code"), description paragraph that sells the problem-solution fit
  - **Why devorch**: 3-4 compelling benefits with short descriptions (not a feature list — sell outcomes: "Zero context switching", "Parallel execution", "Automatic validation", "State-aware resumption")
  - **Quick start**: Install + first workflow in under 30 seconds of reading
  - **Workflows**: Keep the existing workflow examples but frame them as "What you can do" with brief outcome-focused intros
  - **How it works**: Simplified architecture overview — planning → execution → verification cycle. Keep the agents table, scripts table, and key concepts but trim the deep technical detail
  - **Commands reference**: Keep the full table — this is high-value reference content
  - **Agent Teams (experimental)**: Keep but frame as "Advanced: Multi-Agent Teams" with excitement about the capability
  - **LLM-Friendly Project Summary**: A clearly marked section at the bottom with structured metadata for AI agents:
    ```
    <!-- LLM-FRIENDLY PROJECT SUMMARY -->
    ## For AI Agents

    Structured metadata: project name, description, capabilities list, command list with signatures, architecture summary, file structure, key concepts (phases, waves, tasks, builders, validators), state files and their purposes. Format as a flat, parseable reference — not prose.
    ```
  - **Footer**: License badge, requirements, link to Claude Code
  - **Tone guidelines**: Confident, direct, outcome-focused. Use active voice. Short paragraphs. No jargon without explanation. Make a developer want to try it within 10 seconds of landing on the page.
  - **Formatting**: Use badges at top (license, Bun, Claude Code), clean section headers, code blocks for all CLI examples, tables for reference data

#### 3. Validate Phase
- **ID**: validate-phase-1
- **Assigned To**: validator
- Verify `LICENSE` file exists with MIT license text
- Verify `package.json` has `"license": "MIT"`
- Verify `README.md` has been rewritten with: hero section, benefits section, quick start, workflows, commands reference, LLM-friendly section
- Verify README contains `<!-- LLM-FRIENDLY PROJECT SUMMARY -->` comment marker
- Verify README tone is marketing-friendly (not dry/technical)
</tasks>

<execution>
**Wave 1** (parallel): create-license, rewrite-readme
**Wave 2** (validation): validate-phase-1
</execution>

<criteria>
- [ ] `LICENSE` file exists in project root with valid MIT license text and year 2026
- [ ] `package.json` includes `"license": "MIT"` field
- [ ] `README.md` opens with a compelling hero section (project name + value proposition)
- [ ] `README.md` has a benefits/why section that sells outcomes, not features
- [ ] `README.md` has a quick start section with install + first workflow
- [ ] `README.md` has a complete commands reference table
- [ ] `README.md` has a clearly marked LLM-friendly metadata section with structured project data
- [ ] `README.md` tone is marketing-friendly and persuasive throughout
</criteria>

<validation>
- `test -f LICENSE && echo "LICENSE exists"` — license file created
- `grep -q "MIT" LICENSE && echo "MIT license"` — contains MIT text
- `grep -q '"license"' package.json && echo "license field exists"` — package.json updated
- `grep -q "LLM-FRIENDLY" README.md && echo "LLM section exists"` — LLM metadata section present
</validation>
</phase1>
