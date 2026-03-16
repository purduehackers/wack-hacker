import { tool, type ToolSet } from "ai";
import { start } from "workflow/api";
import { z } from "zod";

import type { AgentContext } from "../context";

import { documentation } from "../agents/docs/tools";
import { DiscordRole } from "../context/enums";

const delegationSchema = z.object({
  task: z.string().describe("The task to delegate, forwarded verbatim"),
});

/**
 * Build the tool set for the top-level chat agent.
 *
 * All roles get the documentation tool (knowledge base queries).
 * Organizers and division leads additionally get delegation tools
 * that launch domain agent workflows as child workflows.
 */
export function createChatTools(ctx: AgentContext) {
  const tools: ToolSet = { documentation };
  const isAdmin = ctx.role === DiscordRole.DivisionLead;

  if (ctx.role === DiscordRole.Organizer || isAdmin) {
    tools.linear = tool({
      description: `Delegate to the Linear agent for project management — issues, projects, initiatives, documents, comments, cycles, labels, teams, and users. Forward the user's request verbatim.`,
      inputSchema: delegationSchema,
      execute: ({ task }) => launchAgent("linear", task, isAdmin),
    });

    tools.github = tool({
      description: `Delegate to the GitHub agent for repository management — repos, issues, pull requests, code search, CI/CD workflows, deployments, packages, projects, secrets, and org settings. Forward the user's request verbatim.`,
      inputSchema: delegationSchema,
      execute: ({ task }) => launchAgent("github", task, isAdmin),
    });

    tools.notion = tool({
      description: `Delegate to the Notion agent for workspace content — pages, databases, comments, and users. Use for direct Notion operations (reading/writing pages, querying databases), not for general questions (use documentation instead). Forward the user's request verbatim.`,
      inputSchema: delegationSchema,
      execute: ({ task }) => launchAgent("notion", task, isAdmin),
    });

    tools.discord = tool({
      description: `Delegate to the Discord agent for server management — channels, roles, members, messages, webhooks, scheduled events, threads, and emojis. Forward the user's request verbatim.`,
      inputSchema: delegationSchema,
      execute: ({ task }) => launchAgent("discord", task, isAdmin),
    });
  }

  return tools;
}

const AGENT_LOADERS = {
  linear: () => import("../agents/linear/workflow").then((m) => m.linearAgent),
  github: () => import("../agents/github/workflow").then((m) => m.githubAgent),
  notion: () => import("../agents/notion/workflow").then((m) => m.notionAgent),
  discord: () => import("../agents/discord/workflow").then((m) => m.discordAgent),
} as const;

/** Launch a domain agent as a child workflow and await its text result. */
async function launchAgent(name: keyof typeof AGENT_LOADERS, task: string, isAdmin: boolean) {
  "use step";
  try {
    const workflow = await AGENT_LOADERS[name]();
    const run = await start(workflow, [task, isAdmin]);
    return await run.returnValue;
  } catch {
    return `The ${name} agent is not yet available.`;
  }
}
