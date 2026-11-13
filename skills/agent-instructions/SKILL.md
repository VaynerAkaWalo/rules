---
name: agent-instructions
description: Use when you write instructions for an agent, like a skill, an instruction file such as instructions.md or AGENTS.md, or a prompt for another agent.
---

Write for a frontier model. Name the core idea that changes results and leave out steps it would take anyway.

A skill's description says only when to use it, never what it does, because agents pick skills by that line alone and a summary there makes them act on it without loading the body. Keep facts that change, like model names or versions, in the body so the description stays stable.
