---
name: brothers-in-arms
description: Required before you share a pull or merge request link or call it ready to merge. Have the newest frontier Claude or GPT model from the other family verify it.
---

## Reviewer

Use the newest frontier model of the other family, so Claude work goes to the latest GPT and GPT work goes to the latest Claude Opus. Fall back to the newest frontier model of your own family when the other one isn't available, and never use a reviewer outside Claude and GPT. For now never pick a Fable or Astra family model as the reviewer, even when it is the newest one available, and skip to the next newest model instead.

## Scope

The first review covers the whole merge request. Every later review covers only the commits since the previous review, together with any findings still open from it. You can skip a review when every commit since the previous one was dictated exactly by the user or doesn't change behavior, like renames, copy or formatting, and say in your reply that you skipped it.

## What counts as a finding

Ask the reviewer to report only problems that can realistically happen given how the code is actually called and deployed, each with a concrete failure scenario. Speculative edge cases and style preferences no rule backs are not findings.

Also ask it to check the change against the project and user instruction files, like AGENTS.md and CLAUDE.md, and to name the rule each such finding breaks. Pass it the paths of those files, because a reviewer from another provider may not load them on its own.

For visual changes, pass the screenshots too and ask whether they show what the user asked for.

## Loop

Fix the findings or explain why you won't, then request a fresh review of the new commits that includes only the findings you declined and why. Repeat until both of you agree it is ready to merge. Bring a disagreement you can't resolve, or anything still open after three rounds, to the user instead of looping. Start counting again when the user asks for a substantial change, like a redesign or new behavior, but not for nits or small tweaks.

Return the link only after that agreement, together with a short note on what the review changed.
