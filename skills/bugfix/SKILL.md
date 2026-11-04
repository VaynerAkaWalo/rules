---
name: bugfix
description: Use when fixing a bug or a failing check, and whenever a fix attempt has already failed.
---

Reproduce the bug before fixing it and confirm the fix against the same repro. Every change has to trace back to evidence, so revert code that a disproved hypothesis motivated.

If the state that broke the code is legitimate, handle it where it broke. Otherwise fix whatever produced it instead of guarding against it.

After two failed fixes, test the assumption they share before writing a third.
