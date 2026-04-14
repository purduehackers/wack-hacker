import { tool } from "ai";
import { z } from "zod";

import type { UserRole } from "../constants.ts";
import type { SkillRegistry } from "./registry.ts";

/**
 * Create the `loadSkill` tool bound to a registry and role.
 *
 * When called, it returns the skill's full instructions wrapped in XML
 * so the model treats it as authoritative guidance. The actual tool
 * activation happens via `prepareStep` in the orchestrator.
 */
export function createLoadSkillTool(registry: SkillRegistry, role: UserRole) {
  return tool({
    description:
      "Load a skill to get detailed instructions and activate its tools. " +
      "Call this BEFORE using any skill-specific tools. " +
      "Available skills are listed in <available_skills>.",
    inputSchema: z.object({
      name: z.string().describe("The skill name to load"),
    }),
    execute: async ({ name }) => {
      const skill = registry.loadSkill(name, role);
      if (!skill) {
        const available = registry.getAvailableSkills(role).map((s) => s.name);
        return `Unknown skill "${name}". Available: ${available.join(", ")}`;
      }
      const toolList = skill.toolNames.length > 0 ? skill.toolNames.join(", ") : "none";
      return `<skill name="${skill.name}">
<description>${skill.description}</description>
<criteria>${skill.criteria}</criteria>
<instructions>
${skill.instructions}
</instructions>
<tools>${toolList}</tools>
</skill>`;
    },
  });
}
