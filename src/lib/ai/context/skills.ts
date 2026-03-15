import { tool } from "ai";
import matter from "gray-matter";
import { join } from "node:path";
import { z } from "zod";

import type { Skill } from "./types";

/**
 * Progressive disclosure skill system for domain agents.
 *
 * Discovers SKILL.md files by scanning subdirectories of `skillsDir`,
 * caches them, and provides a `load_skill` AI tool that returns the full
 * skill bundle wrapped in XML so the model treats it as authoritative guidance.
 */
export class SkillSystem {
  readonly skillNames: string[];
  readonly baseToolNames: readonly string[];
  private readonly skillsDir: string;
  private cache: Record<string, Skill> | null = null;

  constructor(config: { skillsDir: string; baseToolNames: readonly string[] }) {
    this.skillsDir = config.skillsDir;
    this.baseToolNames = config.baseToolNames;
    this.skillNames = Array.from(
      new Bun.Glob("*/SKILL.md").scanSync({ cwd: config.skillsDir }),
      (path) => path.split("/")[0],
    ).sort();
  }

  /** Load all skills into the cache (no-op if already loaded). */
  async getSkills() {
    if (!this.cache) {
      const entries = await Promise.all(
        this.skillNames.map(async (name) => [name, await this.loadSkillFile(name)] as const),
      );
      this.cache = Object.fromEntries(entries);
    }
    return this.cache;
  }

  /** Parse a single SKILL.md file from disk. */
  private async loadSkillFile(skillName: string) {
    const raw = await Bun.file(join(this.skillsDir, skillName, "SKILL.md")).text();
    const { data, content } = matter(raw);
    return {
      name: (data.name as string) ?? skillName,
      description: (data.description as string) ?? "",
      criteria: (data.criteria as string) ?? "",
      instructions: content.trimStart(),
      toolNames: data.tools
        ? String(data.tools)
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    };
  }

  /** Format `- name: description` lines for injection into a system prompt. */
  async getSkillMetadata() {
    const skills = await this.getSkills();
    return Object.values(skills)
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");
  }

  /** Return the tool names unlocked by a given skill. */
  async getSkillToolNames(skill: string) {
    const skills = await this.getSkills();
    return skills[skill]?.toolNames ?? [];
  }

  /**
   * Create an AI SDK `load_skill` tool.
   * @param onLoad - Optional callback fired when a skill is loaded (for tracking).
   */
  createLoadSkillTool(onLoad?: (skill: string) => void) {
    return tool({
      description: `Load a skill to enable its tools and guidance for this session. Call this BEFORE performing a task. Available skills: ${this.skillNames.join(", ")}`,
      inputSchema: z.object({
        skill: z.enum(this.skillNames as [string, ...string[]]).describe("The skill to load"),
      }),
      execute: async ({ skill }) => {
        const skills = await this.getSkills();
        const s = skills[skill];
        if (!s) return `Unknown skill: ${skill}. Available: ${this.skillNames.join(", ")}`;
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

  /** Load a prompt template and replace `{{SKILL_METADATA}}` with the skill list. */
  async resolveSystemPrompt(templatePath: string) {
    const template = await Bun.file(templatePath).text();
    const metadata = await this.getSkillMetadata();
    return template.replace("{{SKILL_METADATA}}", metadata);
  }
}
