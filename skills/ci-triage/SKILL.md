---
name: ci-triage
description: Use when CI fails on a pull or merge request, before you retry a job or change code.
---

A failure in code the diff doesn't touch usually means a stale base. A flake gets one retry, and the same failure twice isn't a flake.
