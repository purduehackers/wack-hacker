import type { UIMessageChunk } from "ai";

import { DurableAgent } from "@workflow/ai/agent";
import { getWritable } from "workflow";

import { SkillSystem } from "../../context/skills";
import { SKILLS, SYSTEM_PROMPT } from "./prompts/constants";

export async function discordAgent(task: string, _isAdmin = false) {
  "use workflow";

  const writable = getWritable<UIMessageChunk>();
  return await run(task, writable);
}

async function run(task: string, writable: WritableStream<UIMessageChunk>) {
  "use step";
  const skills = new SkillSystem({ skills: SKILLS, systemPrompt: SYSTEM_PROMPT });
  const system = skills.resolveSystemPrompt();
  const domainTools = await import("./tools");
  const tools = { load_skill: skills.createLoadSkillTool(), ...domainTools };

  const agent = new DurableAgent({ model: "anthropic/claude-sonnet-4", system, tools });
  const result = await agent.stream({
    messages: [{ role: "user", content: task }],
    writable,
    maxSteps: 15,
  });

  return result.steps?.at(-1)?.text ?? "";
}
