---
name: reflect
description: Use when the user asks to reflect on a conversation, or to look through past conversations for lessons, patterns or recurring mistakes worth turning into rules.
---

Cover the current conversation unless I name others. Claude Code transcripts are in `~/.claude/projects/<project>/*.jsonl` and Codex ones in `~/.codex/sessions`. When the transcripts in scope don't fit in your context, split them across subagents and check the excerpts they cite.

Look for three kinds of signal:

- Judgment: where I corrected or redirected you, where a review found a mistake, where work was redone, and which assumptions turned out wrong.
- Tooling: context I supplied by hand that you could have fetched, repeated manual steps, and skills or tools that should have triggered but didn't.
- Blind spots: decisions nobody questioned that later cost time.

Keep a finding only if it will still be true in six months, changes what a future agent does instead of just adding text to read, and recurs or is likely to. Before proposing rule text, read the rules in the rules repo. If an existing rule already covers the finding and was ignored, propose rewording or moving that rule instead of adding a duplicate.

Prefer enforcement over prose. Change the structure so the mistake can't happen, or catch it with types, a lint whose message names the fix, a test or a script, and write a rule only when none of those fit, because nothing fails when an agent skips a rule. Show that a new check fails on a real past instance.

Present each finding with its evidence and proposed wording, and wait for my approval before changing anything.
