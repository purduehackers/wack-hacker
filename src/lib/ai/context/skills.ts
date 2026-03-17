import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { Skill } from "./types";

const ADMIN_MARKER = Symbol("admin");

/**
 * Progressive disclosure skill system for domain agents.
 *
 * Discovers SKILL.md files by scanning subdirectories of `skillsDir`,
 * caches them, and provides a `load_skill` AI tool that returns the full
 * skill bundle wrapped in XML so the model treats it as authoritative guidance.
 *
 * All file I/O is deferred to method calls (not constructor) so this class
 * can be instantiated at module top-level in workflow files without triggering
 * Node.js module imports at bundle time.
 */
export class SkillSystem {
  skillNames: string[] | null = null;
  readonly baseToolNames: readonly string[];
  private readonly skillsDir: string;
  private cache: Record<string, Skill> | null = null;

  constructor(config: { skillsDir: string; baseToolNames: readonly string[] }) {
    this.skillsDir = config.skillsDir;
    this.baseToolNames = config.baseToolNames;
  }

  /** Discover skill names from disk (lazy, cached). */
  private async discoverSkills() {
    if (!this.skillNames) {
      const { readdirSync } = await import("node:fs");
      this.skillNames = readdirSync(this.skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    }
    return this.skillNames;
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

  /** Load all skills into the cache (no-op if already loaded). */
  async getSkills() {
    if (!this.cache) {
      const names = await this.discoverSkills();
      const entries = await Promise.all(
        names.map(async (name) => [name, await this.loadSkillFile(name)] as const),
      );
      this.cache = Object.fromEntries(entries);
    }
    return this.cache;
  }

  /** Parse a single SKILL.md file from disk. */
  private async loadSkillFile(skillName: string) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const matter = (await import("gray-matter")).default;
    const raw = await fs.readFile(path.join(this.skillsDir, skillName, "SKILL.md"), "utf-8");
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
      description: `Load a skill to enable its tools and guidance for this session. Call this BEFORE performing a task.`,
      inputSchema: z.object({
        skill: z.string().describe("The skill to load"),
      }),
      execute: async ({ skill }) => {
        const skills = await this.getSkills();
        const names = Object.keys(skills);
        const s = skills[skill];
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

  /** Load a prompt template and replace `{{SKILL_METADATA}}` with the skill list. */
  async resolveSystemPrompt(templatePath: string) {
    const fs = await import("node:fs/promises");
    const template = await fs.readFile(templatePath, "utf-8");
    const metadata = await this.getSkillMetadata();
    return template.replace("{{SKILL_METADATA}}", metadata);
  }
}
