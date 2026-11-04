---
name: knowledge
description: Use when a task needs facts about my projects' infrastructure, like production access, deploys, secrets or which repo owns what, and when I ask to add to the knowledge base or ingest facts from conversations.
---

My knowledge base is the private repo `VaynerAkaWalo/knowledge`, checked out at `~/code/knowledge`. Clone it with `gh` if it's missing and pull before reading. Its AGENTS.md defines the fact format.

To answer from it, list facts with `grep -H '^description:' facts/*.md`, read the ones that match and follow their sources on the current default branch, since local checkouts can be stale. When a source disagrees with a fact, the source wins and the fact needs fixing.

To ingest, cover the current conversation unless I name others. Transcripts are in `~/.claude/projects` and `~/.codex/sessions`. Keep only what a future agent couldn't get from the sources, like my corrections, rules with their reasons and where things live. Update or delete an existing fact before adding a new one. Propose the changes and wait for my approval, then open a PR once `bun run lint` and `bun run check-sources` pass.
