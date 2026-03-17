# Wack Hacker

Wack Hacker is the AI-powered Discord bot for [Purdue Hackers](https://purduehackers.com). It coordinates specialized agents to manage Linear, GitHub, Notion, and Discord — all from Discord threads.

Built on [Chat SDK](https://chat-sdk.dev/), [Workflow DevKit](https://useworkflow.dev/), and [AI SDK](https://ai-sdk.dev/) v6.

## Architecture

```
Discord mention
  → Chat SDK handler
  → Workflow DevKit chatWorkflow (durable, multi-turn)
  → DurableAgent (top-level orchestrator)
    → Delegation tools launch domain agent workflows:
      - Linear agent    → issues, projects, initiatives, documents, users
      - GitHub agent    → repos, PRs, code search, CI/CD, org management
      - Notion agent    → pages, databases, comments (native markdown API)
      - Discord agent   → channels, roles, members, messages, events, threads
      - Documentation   → Purdue Hackers knowledge base (ask.purduehackers.com)
    → Each domain agent is its own DurableAgent workflow
      with progressive skill disclosure via SKILL.md files
  → Response posted to Discord thread
  → Hook suspends, awaits next message (multi-turn)
```

### Key patterns

- **DurableAgent per domain**: Each agent runs as its own workflow with independent retry, observability, and step limits.
- **Progressive skill disclosure**: Base tools (search, retrieve) are always available. Write tools are guided by a `load_skill` tool that returns contextual instructions from SKILL.md files.
- **Role-based access**: Public users get documentation only. Organizers get all domain agents. Division Leads additionally get user management tools (invite, suspend, team membership).
- **Approval system**: Destructive operations post a Chat SDK Card with Approve/Deny buttons. The workflow suspends until resumed by button click.
- **Multi-turn conversations**: The chat workflow uses Workflow DevKit hooks to suspend between messages, surviving restarts and deploys.

## Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.10
- Redis instance
- Discord bot with gateway + interaction endpoints
- GitHub App with org installation
- Linear API key
- Notion integration token

### Environment

```bash
cp .env.example .env
# Fill in all values
```

See [.env.example](.env.example) for all required variables.

### Development

```bash
bun install
bun dev
```

This starts the Nitro dev server with hot reload. You'll need to:

1. Start the Discord gateway listener by hitting `GET /api/discord/gateway`
2. Configure your Discord application's Interactions Endpoint URL to `{BASE_URL}/api/webhooks/discord`

### Scripts

| Command             | Description       |
| ------------------- | ----------------- |
| `bun dev`           | Start dev server  |
| `bun run build`     | Production build  |
| `bun run typecheck` | TypeScript check  |
| `bun run lint`      | Lint with oxlint  |
| `bun run format`    | Format with oxfmt |

## Project structure

```
src/
  env.ts                          — Validated environment variables
  lib/
    bot/
      index.ts                    — Chat SDK bot singleton
      handlers.ts                 — Event handlers (mentions, messages, approvals)
      types.ts                    — ThreadState
    ai/
      context/
        index.ts                  — AgentContext class
        discord.ts                — DiscordContext (role detection from gateway/interaction)
        enums.ts                  — DiscordRole enum
        skills.ts                 — SkillSystem class + admin tool gating
        types.ts                  — Shared types
      chat/
        tools.ts                  — Delegation tools + agent loaders
        prompts/SYSTEM.md         — Orchestrator system prompt
        prompts/SYSTEM_PUBLIC.md  — Public (docs-only) system prompt
      agents/
        docs/tools.ts             — Knowledge base query tool
        linear/                   — Linear agent (40+ tools, 12 skills)
        github/                   — GitHub agent (80+ tools, 10 skills)
        notion/                   — Notion agent (14 tools, 3 skills)
        discord/                  — Discord agent (40 tools, 8 skills)
  server/
    index.ts                      — Hono app
    routes/
      discord.ts                  — Gateway listener endpoint
      webhooks.ts                 — Webhook handler
    workflows/
      chat.ts                     — Multi-turn chat workflow
      approval.tsx                — Approval card + hook system
      types.ts                    — ChatTurnPayload
```

## Adding a new domain agent

1. Create `src/lib/ai/agents/{name}/` with:
   - `client.ts` — API client
   - `workflow.ts` — DurableAgent workflow
   - `tools/*.ts` — One file per skill
   - `prompts/SYSTEM.md` — System prompt with `{{SKILL_METADATA}}` placeholder
   - `prompts/skills/*/SKILL.md` — One per skill with YAML frontmatter

2. Add the agent to `AGENT_LOADERS` in `src/lib/ai/chat/tools.ts`

3. Add a delegation tool in `createChatTools()`

The SkillSystem auto-discovers skills by scanning `prompts/skills/*/SKILL.md`.

## Adding admin-gated tools

Wrap any tool with `SkillSystem.admin()`:

```ts
import { SkillSystem } from "../../../context/skills";

export const dangerous_tool = SkillSystem.admin(tool({
  description: "...",
  inputSchema: z.object({ ... }),
  execute: async (input) => { ... },
}));
```

Admin tools are stripped from the ToolSet for non-Division-Lead users via `SkillSystem.filterAdmin()`.
