import type { ToolSet, UIMessageChunk } from "ai";

import { DurableAgent } from "@workflow/ai/agent";
import { join } from "node:path";
import { getWritable } from "workflow";

import { SkillSystem } from "../../context/skills";

const PROMPT_PATH = join(import.meta.dir, "prompts/SYSTEM.md");
const SKILLS_DIR = join(import.meta.dir, "prompts/skills");

const skills = new SkillSystem({
  skillsDir: SKILLS_DIR,
  baseToolNames: ["load_skill", "get_server_info", "list_channels", "list_roles", "search_members"],
});

/**
 * Discord domain agent workflow.
 *
 * Runs a DurableAgent with Discord server management tools via the REST API.
 * Base tools (server info, channels, roles, member search) are always available.
 */
export async function discordAgent(task: string, _isAdmin = false) {
  "use workflow";

  const system = await loadSystemPrompt();
  const tools = await buildTools();
  const writable = getWritable<UIMessageChunk>();

  const agent = new DurableAgent({ model: "anthropic/claude-sonnet-4", system, tools });

  const result = await agent.stream({
    messages: [{ role: "user", content: task }],
    writable,
    maxSteps: 15,
  });

  return result.steps?.at(-1)?.text ?? "";
}

async function loadSystemPrompt() {
  "use step";
  return skills.resolveSystemPrompt(PROMPT_PATH);
}

async function buildTools() {
  "use step";

  const [base, channels, messages, roles, members, webhooks, events, threads, emojis] =
    await Promise.all([
      import("./tools/base"),
      import("./tools/channels"),
      import("./tools/messages"),
      import("./tools/roles"),
      import("./tools/members"),
      import("./tools/webhooks"),
      import("./tools/events"),
      import("./tools/threads"),
      import("./tools/emojis"),
    ]);

  const tools: ToolSet = {
    load_skill: skills.createLoadSkillTool(),
    ...base,
    ...channels,
    ...messages,
    ...roles,
    ...members,
    ...webhooks,
    ...events,
    ...threads,
    ...emojis,
  };

  return tools;
}
