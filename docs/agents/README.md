# Agents

Wack Hacker has two layers of AI agents: a flat **orchestrator** and one **subagent** per delegate domain. Both are AI SDK `ToolLoopAgent`s, but they're configured very differently.

The orchestrator is **flat**: all tools are visible from the start, and there's no skill-disclosure indirection. The skill system only kicks in _inside_ the subagents that the orchestrator delegates to.

The subagent is **progressive**: it starts with a small discovery toolkit plus a `loadSkill` tool, and uses `loadSkill(name)` to read a sub-skill's instructions and unlock its tools for subsequent steps. See [Skills](../skills/README.md) for the full skill system.

## Contents

| Doc                                      | Topic                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| [Orchestrator](./orchestrator.md)        | Model, system prompt, base tools, delegate tools.                                      |
| [AgentContext](./context.md)             | Execution context (user, channel, date, role), `buildInstructions`, serialization.     |
| [Delegation & subagents](./subagents.md) | `createDelegationTool`, per-subagent config, `DOMAIN_SPEC_OVERRIDES`, `toModelOutput`. |
| [Code sandbox](./code-sandbox.md)        | `delegate_code` — Vercel Sandbox provisioning, credential brokering, `postFinish` PR.  |
| [Approvals](./approvals.md)              | `approval()` wrapper, Discord button prompt, `ApprovalStore`, `wrapApprovalTools`.     |
| [Streaming](./streaming.md)              | `streamTurn`: the live Discord message edit loop.                                      |
| [Role-based access](./roles.md)          | `UserRole`, `ROLE_IDS`, `buildDelegationTools`, `filterAdmin`, `getAvailableSkills`.   |
| [Adding a base tool](./adding-tools.md)  | How to add a new flat tool to the orchestrator (not a delegate domain).                |

## Where they plug in

The orchestrator is only instantiated inside `streamTurn`, which is in turn only called from `chatWorkflow` and `taskWorkflow` (see [Workflows](../workflows/README.md)). You should rarely need to call `createOrchestrator` directly from anywhere else.
