@AGENTS.md

## Claude Code

This repository enables the Superpowers plugin for itself (`.claude/settings.json`). Use its skills for every app change:

- `superpowers:brainstorming` before building or changing a feature. The design goes in `docs/superpowers/specs/`.
- `superpowers:writing-plans` once the design is approved. The plan goes in `docs/superpowers/plans/`.
- `superpowers:test-driven-development` while implementing, which is the red, green, refactor rule in AGENTS.md.
- `superpowers:systematic-debugging` for a bug, before proposing a fix.
- `superpowers:verification-before-completion` before calling a change done, with the definition of done in AGENTS.md as the checks.
- `superpowers:finishing-a-development-branch` to push and open the pull request, following the branch and pull request rules in AGENTS.md.

Where a skill and AGENTS.md disagree, AGENTS.md wins.

The Playwright planner, generator and healer agents are in `.claude/agents/`. Plans go in `specs/` and generated tests in `e2e/`, starting from `e2e/seed.spec.ts`. They use the Playwright test MCP server in `.mcp.json`, which runs it with `cmd /c` for Windows; on macOS or Linux use `"command": "npx"` with the same arguments.
