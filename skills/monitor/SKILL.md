---
name: monitor
description: Wait for GitHub pull requests to merge or CI checks to pass, then continue an already authorized task without requiring a manual resume.
---

Use monitoring when an external condition blocks the next step of the current task. Choose the condition, a bounded deadline, and what to do when it resolves before starting. Monitoring does not authorize merging or other actions that need approval.

Resolve `../../tools/monitor.ts` relative to this skill directory and use its absolute path. It requires Bun and an authenticated `gh` CLI.

```sh
bun <absolute-monitor-path> github-pr https://github.com/owner/repo/pull/123 --until merged --timeout 30m --interval 30s
bun <absolute-monitor-path> github-pr https://github.com/owner/repo/pull/123 --until checks-passed --timeout 15m
```

Keep the turn active while monitoring. If the harness yields a process or session handle, wait on that same handle using its native process-wait tool until the command finishes. Use waits of at most 60 seconds when configurable so user input and progress updates remain responsive. Do not end the turn with a request to resume while the monitor is pending. A detached script cannot wake a finished agent turn.

Stdout contains one terminal JSON result with `status`, `reason`, `url`, `until`, `elapsedSeconds`, and the last observed `headSha` when available. Progress appears on stderr only when the observation changes. Read the JSON directly instead of wrapping the command to extract its exit code.

- `ready` (exit 0) means the condition was observed. Continue the authorized next step. Recheck the head SHA before taking an action that depends on that commit.
- `failed` (exit 1) means the PR closed without merging or a check failed or was cancelled. Inspect the failure and address it within the current task's scope.
- `timeout` (exit 124) means the condition remains unresolved. Report the last observation. Do not restart indefinitely.
- `error` (exit 2) means the monitor could not establish the condition. Authentication and invalid responses stop immediately. Transient failures get at most three consecutive attempts.
- `cancelled` (exit 130) means monitoring was interrupted. Follow the user's latest direction.

`checks-passed` follows the current PR head and evaluates all reported checks, including legacy commit statuses. Neutral and skipped checks count as successful. No reported checks remains pending. This is an observation of reported CI, not a guarantee that every expected workflow has started or that branch protection allows merging.
