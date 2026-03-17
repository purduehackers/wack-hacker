import type { UIMessageChunk } from "ai";

import { DurableAgent } from "@workflow/ai/agent";
import { getWritable } from "workflow";

import { SkillSystem } from "../../context/skills";
import { SKILLS, SYSTEM_PROMPT } from "./prompts/constants";

export async function linearAgent(task: string, isAdmin = false) {
  "use workflow";

  const writable = getWritable<UIMessageChunk>();
  return await run(task, isAdmin, writable);
}

async function run(task: string, isAdmin: boolean, writable: WritableStream<UIMessageChunk>) {
  "use step";
  const skills = new SkillSystem({ skills: SKILLS, systemPrompt: SYSTEM_PROMPT });
  const system = skills.resolveSystemPrompt();
  const domainTools = await import("./tools");
  const allTools = { load_skill: skills.createLoadSkillTool(), ...domainTools };
  const tools = isAdmin ? allTools : SkillSystem.filterAdmin(allTools);

  const agent = new DurableAgent({ model: "anthropic/claude-sonnet-4", system, tools });
  const result = await agent.stream({
    messages: [{ role: "user", content: task }],
    writable,
    maxSteps: 15,
  });

  return result.steps?.at(-1)?.text ?? "";
}
