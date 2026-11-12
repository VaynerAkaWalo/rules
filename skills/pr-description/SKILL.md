---
name: pr-description
description: Use when you open a pull or merge request, and after a push that changes what it does or what you verified.
---

A title says why the change matters rather than which mechanism changed. The description opens with the problem the change solves, in the words of whoever asked for it, then the solution in a few sentences instead of a list of every change, and keeps the rollout steps, risks and what you didn't verify. End it with the models and harness that wrote the change, like `Created with Opus 5.5 in Claude Code.`

After a push that changes what the PR does or what you verified, rewrite the title and description to match the whole change, since they become stale while review fixes pile up.
