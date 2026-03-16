import type { ToolSet, UIMessageChunk } from "ai";

import { DurableAgent } from "@workflow/ai/agent";
import { getWritable } from "workflow";

import { SkillSystem } from "../../context/skills";

export async function githubAgent(task: string, isAdmin = false) {
  "use workflow";

  const { system, tools: allTools } = await setup();
  const tools = isAdmin ? allTools : SkillSystem.filterAdmin(allTools);
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
  const path = await import("node:path");
  const baseDir = path.join(__dirname, "../lib/ai/agents/github");

  const skills = new SkillSystem({
    skillsDir: path.join(baseDir, "prompts/skills"),
    baseToolNames: [
      "load_skill", "list_repositories", "get_repository",
      "search_code", "search_issues",
    ],
  });

  const system = await skills.resolveSystemPrompt(path.join(baseDir, "prompts/SYSTEM.md"));
  const domainTools = await import("./tools");
  const tools: ToolSet = { load_skill: skills.createLoadSkillTool(), ...domainTools };

  return { system, tools };
}
