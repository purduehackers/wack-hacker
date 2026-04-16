---
name: profiling
description: View CPU profiling data — flamegraphs and slowest functions.
criteria: Use when the user asks about profiling, flamegraphs, CPU usage, slow functions, or function-level performance.
tools: [get_flamegraph, list_profiled_functions]
minRole: organizer
mode: inline
---

<flamegraph>
- get_flamegraph returns CPU time distribution across function calls.
- Requires project_id (numeric) and transaction name.
- Useful for identifying which functions consume the most CPU time.
</flamegraph>

<functions>
- list_profiled_functions shows the slowest functions by self-time.
- Sort by p75(), p95(), p99(), count(), or avg().
- Filter by transaction to focus on a specific endpoint.
- Shows function name, package, and time percentiles.
</functions>
