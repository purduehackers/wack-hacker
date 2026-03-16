import type { ToolSet, UIMessageChunk } from "ai";

import { DurableAgent } from "@workflow/ai/agent";
import { join } from "node:path";
import { getWritable } from "workflow";

import { SkillSystem } from "../../context/skills";

const PROMPT_PATH = join(import.meta.dir, "prompts/SYSTEM.md");
const SKILLS_DIR = join(import.meta.dir, "prompts/skills");

const skills = new SkillSystem({
  skillsDir: SKILLS_DIR,
  baseToolNames: [
    "load_skill",
    "search_notion",
    "retrieve_page",
    "retrieve_database",
    "list_users",
  ],
});

/**
 * Notion domain agent workflow.
 *
 * Runs a DurableAgent with Notion workspace tools and progressive skill disclosure.
 * Base tools (search, retrieve page/database, list users) are always available.
 */
export async function notionAgent(task: string, _isAdmin = false) {
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

  const [base, pages, databases, comments] = await Promise.all([
    import("./tools/base"),
    import("./tools/pages"),
    import("./tools/databases"),
    import("./tools/comments"),
  ]);

  const tools: ToolSet = {
    load_skill: skills.createLoadSkillTool(),
    ...base,
    ...pages,
    ...databases,
    ...comments,
  };

  return tools;
}
