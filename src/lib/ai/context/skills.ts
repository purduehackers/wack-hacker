import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { Skill } from "./types";

const ADMIN_MARKER = Symbol("admin");

/**
 * Progressive disclosure skill system for domain agents.
 *
 * Accepts pre-loaded skills and system prompt (generated at build time
 * from SKILL.md files), and provides a `load_skill` AI tool that returns
 * the full skill bundle wrapped in XML so the model treats it as
 * authoritative guidance.
 */
export class SkillSystem {
  private readonly skills: Record<string, Skill>;
  private readonly systemPrompt: string;

  constructor(config: { skills: Record<string, Skill>; systemPrompt: string }) {
    this.skills = config.skills;
    this.systemPrompt = config.systemPrompt;
  }

  /** Mark a tool as requiring admin (Division Lead) access. */
  static admin<T>(t: T) {
    (t as any)[ADMIN_MARKER] = true;
    return t;
  }

  /** Return a copy of the ToolSet with admin-marked tools removed. */
  static filterAdmin(tools: ToolSet) {
    const filtered: ToolSet = {};
    for (const [name, t] of Object.entries(tools)) {
      if (!(t as any)[ADMIN_MARKER]) {
        filtered[name] = t;
      }
    }
    return filtered;
  }

  /** Format `- name: description` lines for injection into a system prompt. */
  getSkillMetadata() {
    return Object.values(this.skills)
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");
  }

  /** Resolve the system prompt by replacing `{{SKILL_METADATA}}` with the skill list. */
  resolveSystemPrompt() {
    return this.systemPrompt.replace("{{SKILL_METADATA}}", this.getSkillMetadata());
  }

  /**
   * Create an AI SDK `load_skill` tool.
   * @param onLoad - Optional callback fired when a skill is loaded (for tracking).
   */
  createLoadSkillTool(onLoad?: (skill: string) => void) {
    return tool({
      description: `Load a skill to enable its tools and guidance for this session. Call this BEFORE performing a task.`,
      inputSchema: z.object({
        skill: z.string().describe("The skill to load"),
      }),
      execute: async ({ skill }) => {
        const names = Object.keys(this.skills);
        const s = this.skills[skill];
        if (!s) return `Unknown skill: ${skill}. Available: ${names.join(", ")}`;
        onLoad?.(skill);
        const toolList = s.toolNames.length > 0 ? s.toolNames.join(", ") : "none";
        return `Loaded skill: ${s.name}

<loaded-skill name="${s.name}">
<description>${s.description}</description>
<criteria>${s.criteria}</criteria>
<instructions>
${s.instructions}
</instructions>
<tools>${toolList}</tools>
</loaded-skill>`;
      },
    });
  }
}
