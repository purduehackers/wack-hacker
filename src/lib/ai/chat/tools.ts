import { ToolLoopAgent, stepCountIs, tool, type ToolSet } from "ai";

import { z } from "zod";

import type { SerializedAgentContext } from "../context/types";

import { documentation } from "../agents/docs/tools";
import { DiscordRole } from "../context/constants";
import { SkillSystem } from "../context/skills";

const delegationSchema = z.object({
  task: z.string().describe("The task to delegate, forwarded verbatim"),
});

const AGENTS = {
  linear: {
    description:
      "Delegate to the Linear agent for project management — issues, projects, initiatives, documents, comments, cycles, labels, teams, and users. Forward the user's request verbatim.",
    config: () => import("../agents/linear/prompts/constants"),
    tools: () => import("../agents/linear/tools"),
  },
  github: {
    description:
      "Delegate to the GitHub agent for repository management — repos, issues, pull requests, code search, CI/CD workflows, deployments, packages, projects, secrets, and org settings. Forward the user's request verbatim.",
    config: () => import("../agents/github/prompts/constants"),
    tools: () => import("../agents/github/tools"),
  },
  notion: {
    description:
      "Delegate to the Notion agent for workspace content — pages, databases, comments, and users. Use for direct Notion operations (reading/writing pages, querying databases), not for general questions (use documentation instead). Forward the user's request verbatim.",
    config: () => import("../agents/notion/prompts/constants"),
    tools: () => import("../agents/notion/tools"),
  },
  discord: {
    description:
      "Delegate to the Discord agent for server management — channels, roles, members, messages, webhooks, scheduled events, threads, and emojis. Forward the user's request verbatim.",
    config: () => import("../agents/discord/prompts/constants"),
    tools: () => import("../agents/discord/tools"),
  },
} as const;

type AgentName = keyof typeof AGENTS;

/**
 * Build the tool set for the top-level chat agent.
 *
 * All roles get the documentation tool (knowledge base queries).
 * Organizers and division leads additionally get delegation tools
 * that run domain subagents inline with streaming.
 */
export function createChatTools(ctx: SerializedAgentContext): ToolSet {
  const tools: ToolSet = { documentation };
  const isAdmin = ctx.role === DiscordRole.DivisionLead;

  if (ctx.role === DiscordRole.Organizer || isAdmin) {
    for (const [name, agent] of Object.entries(AGENTS)) {
      tools[name] = tool({
        description: agent.description,
        inputSchema: delegationSchema,
        execute: async function* ({ task }) {
          yield* runSubagent(name as AgentName, task, isAdmin);
        },
      });
    }
  }

  return tools;
}

/**
 * Run a domain subagent inline, streaming text as preliminary tool results.
 *
 * Each accumulated chunk is yielded back to the parent's fullStream,
 * where withToolProgress re-emits it as displayable text for Discord.
 */
async function* runSubagent(name: AgentName, task: string, isAdmin: boolean) {
  const { instructions, tools } = await loadAgentConfig(name, isAdmin);

  const agent = new ToolLoopAgent({
    model: "anthropic/claude-sonnet-4",
    instructions,
    tools,
    stopWhen: stepCountIs(15),
  });

  const result = await agent.stream({ prompt: task });

  let accumulated = "";
  for await (const chunk of result.textStream) {
    accumulated += chunk;
    yield accumulated;
  }
}

/** Load a domain agent's system prompt and tools. */
async function loadAgentConfig(name: AgentName, isAdmin: boolean) {
  const { SKILLS, SYSTEM_PROMPT } = await AGENTS[name].config();
  const skills = new SkillSystem({ skills: SKILLS, systemPrompt: SYSTEM_PROMPT });
  const instructions = skills.resolveSystemPrompt();

  const domainTools = await AGENTS[name].tools();
  const allTools: ToolSet = { load_skill: skills.createLoadSkillTool(), ...domainTools };
  const tools = isAdmin ? allTools : SkillSystem.filterAdmin(allTools);

  return { instructions, tools };
}
