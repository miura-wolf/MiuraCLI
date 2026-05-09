# Skill Registry — MiuraSwarm

**Generated**: 2026-05-08
**Project**: miuraswarm
**Stack**: TypeScript ESM, Node 22+

## User Skills

| Skill | Trigger | Source |
|-------|---------|--------|
| go-testing | Go tests, Bubbletea TUI testing | ~/.claude/skills/ |
| skill-creator | Creating new AI skills | ~/.claude/skills/ |
| branch-pr | PR creation, opening PR, preparing changes for review | ~/.claude/skills/ |
| issue-creation | Creating GitHub issue, reporting bug, requesting feature | ~/.claude/skills/ |
| judgment-day | Parallel adversarial review | ~/.claude/skills/ |
| sdd-explore | Investigate feature, clarify requirements | ~/.claude/skills/ |
| sdd-propose | Create change proposal | ~/.claude/skills/ |
| sdd-spec | Write specifications, delta specs | ~/.claude/skills/ |
| sdd-design | Technical design, architecture decisions | ~/.claude/skills/ |
| sdd-tasks | Break down change into task checklist | ~/.claude/skills/ |
| sdd-apply | Implement SDD tasks | ~/.claude/skills/ |
| sdd-verify | Validate implementation against specs | ~/.claude/skills/ |
| sdd-archive | Archive completed SDD change | ~/.claude/skills/ |
| sdd-onboard | Guided SDD walkthrough | ~/.claude/skills/ |

## Project Conventions

| File | Purpose |
|------|---------|
| CLAUDE.md (global) | Rules, personality, SDD orchestrator protocol |
| tsconfig.json | ES2024, Node16 modules, strict mode |

## Compact Rules (for sub-agent injection)

### go-testing
- Trigger: writing Go tests, teatest, Bubbletea TUI
- Rule: Read ~/.claude/skills/go-testing/SKILL.md before writing Go tests

### skill-creator
- Trigger: creating new AI skills, agent instructions
- Rule: Follow Agent Skills spec in ~/.claude/skills/skill-creator/SKILL.md

### branch-pr
- Trigger: creating PR, preparing changes for review
- Rule: Follow issue-first enforcement in ~/.claude/skills/branch-pr/SKILL.md

### issue-creation
- Trigger: creating GitHub issue, reporting bug
- Rule: Follow issue-first enforcement in ~/.claude/skills/issue-creation/SKILL.md

### judgment-day
- Trigger: parallel adversarial review needed
- Rule: Launch two blind judges, synthesize, fix, re-judge

### SDD skills
- Trigger: any /sdd-* command
- Rule: Follow the SDD workflow phases as defined in each skill

## Active SDD Context

- **Persistence**: engram
- **Strict TDD**: enabled (Vitest available)
- **Test runner**: `npm test` → vitest run
