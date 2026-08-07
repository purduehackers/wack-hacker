---
name: sandboxes
description: Vercel Sandbox lifecycle, shell commands, snapshots.
criteria: Use when the user asks about Vercel Sandboxes — running ad-hoc commands in ephemeral environments, listing active sandboxes, or managing snapshots.
tools:
  [
    list_sandboxes,
    get_sandbox,
    stop_sandbox,
    extend_sandbox_timeout,
    list_sandbox_commands,
    get_sandbox_command,
    get_sandbox_command_logs,
    kill_sandbox_command,
    list_sandbox_snapshots,
    get_sandbox_snapshot,
    delete_sandbox_snapshot,
  ]
minRole: organizer
mode: inline
---

<compute-cost>
- Sandboxes consume billable compute. `extend_sandbox_timeout` extends the clock; `stop_sandbox` stops the meter.
- Commands kicked off via the SDK run asynchronously — poll `get_sandbox_command` / `get_sandbox_command_logs`.
</compute-cost>

<scope>
- This subagent does NOT expose `run_sandbox_command`, file I/O, sandbox creation, or network policy writes — those have complex request shapes and should be driven from the CLI or dashboard.
</scope>

<snapshots>
- Snapshots capture sandbox state. Deleting one does not affect running sandboxes.
</snapshots>
