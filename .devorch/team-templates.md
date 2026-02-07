# Team Templates

Default team configurations for Agent Teams commands. Each section defines a team structure that `check-agent-teams.ts` parses. Edit roles and sizes to customize team behavior per project.

## debug
- size: 4
- model: opus
### Roles
- investigator-1: Reproduce the issue and gather initial evidence
- investigator-2: Analyze error propagation and state corruption
- investigator-3: Check recent changes and regression patterns
- investigator-4: Explore edge cases and environmental factors

## review
- size: 4
- model: opus
### Roles
- security: Identify security vulnerabilities, injection risks, and auth issues
- quality: Assess code quality, maintainability, and adherence to conventions
- performance: Evaluate performance implications, bottlenecks, and resource usage
- tests: Verify test coverage, edge cases, and testing best practices

## explore-deep
- size: 4
- model: opus
### Roles
- explorer-1: Map system architecture and dependency relationships
- explorer-2: Analyze data flow and state management patterns
- explorer-3: Investigate integration points and external interfaces
- synthesizer: Synthesize findings into a coherent architectural overview

## make-plan-team
- size: 2
- model: opus
### Roles
- scope-explorer: Explore codebase to understand scope, dependencies, and impact
- risk-assessor: Identify risks, edge cases, and potential blockers

## check-team
- size: 3
- model: opus
### Roles
- security: Adversarial security review of implementation
- quality: Adversarial quality and correctness review
- performance: Adversarial performance and scalability review
