@AGENTS.md

## Project skills and agents

The skills in `.claude/skills/` (`playwright-tests`, `visual-check`, `fresh-eyes-review`) are the procedures behind `AGENTS.md`; load the one that matches the task before you start. OpenCode reads the same folder, so nothing is mirrored. The agent `fresh-eyes-reviewer` in `.claude/agents/` runs `sonnet` and wraps `fresh-eyes-review`. Where a skill and `AGENTS.md` disagree, `AGENTS.md` wins.

## Delegating to sub-agents

Use sub-agents by default, within the limits, the brief and the clean-up rules in `AGENTS.md` ("Sub-agents"). Set the `model` parameter explicitly on every `Agent` call and every `agent()` call inside a Workflow script; omitting it silently inherits the session's model. The tiers in `AGENTS.md` are, in Claude Code, `haiku` (small and fast), `sonnet` (default) and `opus` (most capable).

`fable` is the model above them: never start a `fable` agent, set `model: fable` or put it in a Workflow script unless the user has authorised it for this task in words. If you think a task needs it, say why and ask.

## Dynamic workflows (Workflow tool)

Reach for the Workflow tool when a task has 3 or more independent, parallelisable subtasks, or would benefit from a pipeline or judge panel. If `ultracode` is not already on for the session (no `ultracode` keyword, toggle or explicit orchestration request), propose the workflow in one or two sentences (its rough shape and cost) and wait for a go-ahead before invoking it. Every `agent()` call inside a workflow script sets `model` explicitly, from the tiers above.

## Editing the instruction files

This file and `AGENTS.md` load into every session, so each line costs context. Keep each under about 200 lines, state rules as specific, checkable instructions, and put a procedure that matters for one task in a skill. Do not import long documents with `@`. When a rule changes, change it in one place and remove the old wording.
