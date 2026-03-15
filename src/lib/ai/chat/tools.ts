import type { ToolSet } from "ai";

import type { AgentContext } from "../context";
import { DiscordRole } from "../context/enums";

import { documentation } from "../domains/docs/tools";

/**
 * Build the tool set for the top-level chat agent.
 *
 * All roles get the documentation tool (knowledge base queries).
 * Organizers and division leads will additionally get domain delegation
 * tools (linear, discord, notion, github) as those agents are implemented.
 */
export function createChatTools(ctx: AgentContext) {
  const tools: ToolSet = { documentation };

  if (ctx.role === DiscordRole.Organizer || ctx.role === DiscordRole.DivisionLead) {
    // Domain delegation tools will be added here as each agent is implemented.
  }

  return tools;
}
