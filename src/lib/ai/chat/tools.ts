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

  if (ctx.role === DiscordRole.Organizer || ctx.role === DiscordRole.DivisionLead) {
    tools.linear = tool({
      description: `Delegate to the Linear agent for project management — issues, projects, initiatives, documents, comments, cycles, labels, teams, and users. Forward the user's request verbatim.`,
      inputSchema: delegationSchema,
      execute: ({ task }) => launchAgent("linear", task),
    });
  }

  return tools;
}

const AGENT_LOADERS = {
  linear: () => import("../agents/linear/workflow").then((m) => m.linearAgent),
} as const;

/** Launch a domain agent as a child workflow and await its text result. */
async function launchAgent(name: keyof typeof AGENT_LOADERS, task: string) {
  "use step";
  try {
    const workflow = await AGENT_LOADERS[name]();
    const run = await start(workflow, [task]);
    return await run.returnValue;
  } catch {
    return `The ${name} agent is not yet available.`;
  }
}
