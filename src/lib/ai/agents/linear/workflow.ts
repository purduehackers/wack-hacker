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
    "search_entities",
    "retrieve_entities",
    "suggest_property_values",
    "aggregate_issues",
  ],
});

/**
 * Linear domain agent workflow.
 *
 * Runs a DurableAgent with progressive tool disclosure via the skill system.
 * Base tools (search, retrieve, suggest, aggregate) are always available.
 * Write tools are guided by `load_skill` instructions.
 * Tools marked with `SkillSystem.admin()` are stripped for non-admin users.
 */
export async function linearAgent(task: string, isAdmin = false) {
  "use workflow";

  const system = await loadSystemPrompt();
  const allTools = await buildTools();
  const tools = isAdmin ? allTools : SkillSystem.filterAdmin(allTools);
  const writable = getWritable<UIMessageChunk>();

  const agent = new DurableAgent({
    model: "anthropic/claude-sonnet-4",
    system,
    tools,
  });

  const result = await agent.stream({
    messages: [{ role: "user", content: task }],
    writable,
    maxSteps: 15,
  });

  return result.steps?.at(-1)?.text ?? "";
}

/** Load and resolve the system prompt with skill metadata injected. */
async function loadSystemPrompt() {
  "use step";
  return skills.resolveSystemPrompt(PROMPT_PATH);
}

/** Import all tool files and assemble the full tool set. */
async function buildTools() {
  "use step";

  const [
    base,
    issues,
    issueViews,
    comments,
    documents,
    projects,
    projectViews,
    projectUpdates,
    initiatives,
    initiativeUpdates,
    reminders,
    customerRequests,
    users,
  ] = await Promise.all([
    import("./tools/base"),
    import("./tools/issues"),
    import("./tools/issue-views"),
    import("./tools/comments"),
    import("./tools/documents"),
    import("./tools/projects"),
    import("./tools/project-views"),
    import("./tools/project-updates"),
    import("./tools/initiatives"),
    import("./tools/initiative-updates"),
    import("./tools/reminders"),
    import("./tools/customer-requests"),
    import("./tools/users"),
  ]);

  const tools: ToolSet = {
    load_skill: skills.createLoadSkillTool(),
    ...base,
    ...issues,
    ...issueViews,
    ...comments,
    ...documents,
    ...projects,
    ...projectViews,
    ...projectUpdates,
    ...initiatives,
    ...initiativeUpdates,
    ...reminders,
    ...customerRequests,
    ...users,
  };

  return tools;
}
