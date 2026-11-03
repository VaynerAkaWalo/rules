---
name: bugfix
description: Use when fixing a bug, a failing test or check, or any wrong behavior, and whenever a second attempt at fixing the same problem has failed.
---

Reproduce the bug yourself before changing code, on the surface where it was reported, like the running app, the CLI or the failing CI job. If it won't reproduce, narrow the conditions or add temporary logging until it does, and ask me only when you can't reach that environment.

Find the cause with evidence instead of guesses. List the plausible hypotheses and rule them out one by one with runtime evidence from logs, a debugger or a reduced repro. When a hypothesis is disproved, revert the code it motivated. A change that might help is a hypothesis, not a fix, so it doesn't ship.

Fix the first place the system went wrong, not the place where it surfaced. Ask whether the state that broke the code is legitimate. If it is, handling it where it broke is the fix. If it should never exist, a guard there hides the bug, so find and fix whatever produced it. Retries, swallowed errors, clamped values and fallbacks are the usual ways a bug gets hidden. When something fails only after a restart, suspect persisted state like config, caches or lock files first.

When two fixes resting on the same assumption have failed, stop before writing a third. Write the assumption down as one sentence, make an observation that would come out differently if it were false, and follow what it shows.

Look for the same fault elsewhere and fix every instance. Then rerun the original repro and confirm it passes, because unit tests show branch behavior, not that the bug is gone. In the PR say what was broken, the root cause and how you verified the fix.
