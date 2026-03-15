import type { ToolSet } from "ai";

import type { AgentContext } from "../context";

/**
 * Build the tool set for the top-level chat agent.
 * Tools are gated by role — public users only get documentation.
 *
 * Domain tools (docs, linear, discord, notion, github) will be
 * added here as each domain is implemented.
 */
export function createChatTools(_ctx: AgentContext) {
  const tools: ToolSet = {};
  return tools;
}
