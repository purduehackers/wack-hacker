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
    "list_repositories",
    "get_repository",
    "search_code",
    "search_issues",
  ],
});

/**
 * GitHub domain agent workflow.
 *
 * Runs a DurableAgent with the full GitHub tool set and skill system.
 * Tools marked with `SkillSystem.admin()` are stripped for non-admin users.
 */
export async function githubAgent(task: string, isAdmin = false) {
  "use workflow";

  const system = await loadSystemPrompt();
  const allTools = await buildTools();
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

async function loadSystemPrompt() {
  "use step";
  return skills.resolveSystemPrompt(PROMPT_PATH);
}

async function buildTools() {
  "use step";

  const [
    base,
    repositories,
    issues,
    pullRequests,
    contents,
    actions,
    deployments,
    packages,
    projects,
    secretsAndVariables,
    organization,
  ] = await Promise.all([
    import("./tools/base"),
    import("./tools/repositories"),
    import("./tools/issues"),
    import("./tools/pull-requests"),
    import("./tools/contents"),
    import("./tools/actions"),
    import("./tools/deployments"),
    import("./tools/packages"),
    import("./tools/projects"),
    import("./tools/secrets-and-variables"),
    import("./tools/organization"),
  ]);

  const tools: ToolSet = {
    load_skill: skills.createLoadSkillTool(),
    ...base,
    ...repositories,
    ...issues,
    ...pullRequests,
    ...contents,
    ...actions,
    ...deployments,
    ...packages,
    ...projects,
    ...secretsAndVariables,
    ...organization,
  };

  return tools;
}
