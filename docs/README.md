# Wack Hacker Documentation

Reference documentation for the Wack Hacker codebase. The top-level [README](../README.md) covers the elevator pitch and getting started; this folder is for working *inside* the project.

## Contents

| Section                                       | What's in it                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Architecture](./architecture.md)              | High-level shape of the system, request flow, agent hierarchy, and skill system diagrams.                               |
| [Discord layer](./discord/README.md)           | Gateway, interactions, `EventRouter`, queue consumer, and how to write commands/components/events/crons.                 |
| [Agents](./agents/README.md)                   | Orchestrator, delegate subagents, `AgentContext`, role gating, `streamTurn`.                                             |
| [Skills](./skills/README.md)                   | `SKILL.md` format, the registry, progressive disclosure, admin gating, and adding skills or whole delegate domains.      |
| [Workflows & scheduling](./workflows/README.md)| Workflow DevKit usage (`chatWorkflow`, `taskWorkflow`), durable suspension, the tasks queue.                             |
| [Deployment](./deployment/README.md)           | `vercel.ts`, queue triggers, environment variables, build pipeline.                                                      |
| [Testing](./testing.md)                        | Vitest setup, unit vs integration suites, coverage thresholds.                                                           |

## Conventions

- Code paths are written `src/path/to/file.ts` relative to the repo root.
- Tool/function names from the codebase are in `code` font.
- "Domain" always means one of the delegate domains (Discord, GitHub, Linear, Notion, …); domains may come and go, so prefer `<domain>` over hard-coding names in new docs.
- "Subagent" means a nested `ToolLoopAgent` spawned by a delegate tool. "Orchestrator" is the flat top-level agent.

## Where to start

- **New to the codebase?** Read [Architecture](./architecture.md), then skim [Discord layer](./discord/README.md) and [Agents](./agents/README.md).
- **Adding a new bot feature** (slash command, reaction handler, etc.)? Jump to [Discord § writing handlers](./discord/handlers.md).
- **Adding a new agent capability** (a new tool inside an existing domain)? Read [Skills § adding](./skills/adding.md).
- **Adding a whole new domain?** [Skills § adding a new delegate domain](./skills/adding.md#adding-a-new-delegate-domain).
- **Debugging a deploy or queue issue?** [Deployment](./deployment/README.md).
