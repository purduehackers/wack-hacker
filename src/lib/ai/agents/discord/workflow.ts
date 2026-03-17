import type { ToolSet, UIMessageChunk } from "ai";

import { DurableAgent } from "@workflow/ai/agent";
import { getWritable } from "workflow";

import { SkillSystem } from "../../context/skills";
import { SKILLS, SYSTEM_PROMPT } from "./prompts/constants";

export async function discordAgent(task: string, _isAdmin = false) {
  "use workflow";

  const { system, tools } = await setup();
  const writable = getWritable<UIMessageChunk>();

  const agent = new DurableAgent({ model: "anthropic/claude-sonnet-4", system, tools });
  const result = await agent.stream({
    messages: [{ role: "user", content: task }],
    writable,
    maxSteps: 15,
  });

  return result.steps?.at(-1)?.text ?? "";
}

async function setup() {
  "use step";
  const skills = new SkillSystem({
    skills: SKILLS,
    systemPrompt: SYSTEM_PROMPT,
  });

  const system = skills.resolveSystemPrompt();
  const domainTools = await import("./tools");
  const tools: ToolSet = { load_skill: skills.createLoadSkillTool(), ...domainTools };

  return { system, tools };
}
