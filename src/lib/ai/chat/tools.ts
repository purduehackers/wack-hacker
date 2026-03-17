import { tool, type ToolSet } from "ai";
import { start } from "workflow/api";
import { z } from "zod";

import type { SerializedAgentContext } from "../context/types";

import { discordAgent } from "../agents/discord/workflow";
import { documentation } from "../agents/docs/tools";
import { githubAgent } from "../agents/github/workflow";
import { linearAgent } from "../agents/linear/workflow";
import { notionAgent } from "../agents/notion/workflow";
import { DiscordRole } from "../context/constants";

const delegationSchema = z.object({
  task: z.string().describe("The task to delegate, forwarded verbatim"),
});

const AGENTS = {
  linear: linearAgent,
  github: githubAgent,
  notion: notionAgent,
  discord: discordAgent,
} as const;

/**
 * Build the tool set for the top-level chat agent.
 *
 * All roles get the documentation tool (knowledge base queries).
 * Organizers and division leads additionally get delegation tools
 * that launch domain agent workflows as child workflows.
 */
export function createChatTools(ctx: SerializedAgentContext) {
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

/** Launch a domain agent as a child workflow and await its text result. */
async function launchAgent(name: keyof typeof AGENTS, task: string, isAdmin: boolean) {
  "use step";
  try {
    const run = await start(AGENTS[name], [task, isAdmin]);
    return await run.returnValue;
  } catch {
    return `The ${name} agent is not yet available.`;
  }
}
