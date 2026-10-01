---
name: monitor
description: Monitor external conditions that block the current task, then continue authorized work without requiring a manual resume.
---

Use monitoring when an external condition blocks the next step of the current task. Choose the condition, a bounded deadline, and what to do when it resolves before starting. Monitoring does not authorize actions that need approval.

The `monitor` command is installed on PATH by the rules installer. Discover available targets and read the relevant target's help before choosing a command.

```sh
monitor targets
monitor <target> --help
```

Keep the turn active while monitoring. If the harness yields a process or session handle, wait on that same handle using its native process-wait tool until the command finishes. Choose wait durations that fit the expected process and the harness limits. A ten-minute wait can be appropriate for a pipeline. The user can interrupt monitoring when needed. Do not end the turn with a request to resume while the monitor is pending. A detached script cannot wake a finished agent turn.

Monitoring commands write one terminal JSON result with `status`, `reason`, and `elapsedSeconds`, plus target-specific fields described in the help. Progress appears on stderr only when the observation changes. Read the JSON directly instead of wrapping the command to extract its exit code.

- `ready` (exit 0) means the condition was observed. Continue the authorized next step within the guarantees described by the target.
- `failed` (exit 1) means the target observed a terminal failure. Inspect it and address it within the current task's scope.
- `timeout` (exit 124) means the condition remains unresolved. Report the last observation. Do not restart indefinitely.
- `error` (exit 2) means the monitor could not establish the condition. Use the reason to identify the problem rather than restarting indefinitely.
- `cancelled` (exit 130) means monitoring was interrupted. Follow the user's latest direction.
