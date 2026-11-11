---
name: brothers-in-arms
description: Required before you share a pull or merge request link or call it ready to merge. Have GPT 6.1 Sol verify it, or Grok 4.7 when Codex is out of quota.
---

Use GPT 6.1 Sol with medium effort. When Codex is out of quota, use Grok 4.7 with high effort instead. Never use a Claude model as the reviewer.

The first review covers the whole PR, and later ones only the new commits plus the findings you declined and why. Skip a review when the new commits were dictated by the user or don't change behavior, and say so.

Ask for problems that can realistically happen given how the code is called and deployed, each with a concrete failure scenario, and for breaks of the instruction files with the rule named. Pass the AGENTS.md and CLAUDE.md paths, since a reviewer from another provider won't load them, and the screenshots for visual changes.

Treat each finding as a class of mistake, so look for siblings, cover the class with a test and recheck the paths the fix touches. Loop until you both agree it's ready, and bring a disagreement or anything open after three rounds to the user. A substantial change the user asks for resets the count.

Share the link only after that agreement, with a short note on what the review changed.
