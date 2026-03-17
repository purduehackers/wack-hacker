import { tool, type ToolSet } from "ai";
import { useStorage } from "nitro/storage";
import { z } from "zod";

import type { Skill } from "./types";

import { MetaError } from "../../errors";

const ADMIN_MARKER = Symbol("admin");

function getPromptStorage() {
  return useStorage("assets/prompts");
}

/**
 * Progressive disclosure skill system for domain agents.
 *
 * Discovers SKILL.md files by listing keys under `storageBase` in Nitro's
 * `serverAssets` storage layer, caches them, and provides a `load_skill`
 * AI tool that returns the full skill bundle wrapped in XML so the model
 * treats it as authoritative guidance.
 */
export class SkillSystem {
  private skillNames: string[] | null = null;
  readonly baseToolNames: readonly string[];
  private readonly storageBase: string;
  private cache: Record<string, Skill> | null = null;

  constructor(config: { storageBase: string; baseToolNames: readonly string[] }) {
    this.storageBase = config.storageBase;
    this.baseToolNames = config.baseToolNames;
  }

  /** Discover skill names by listing keys under the skills storage path. */
  private async discoverSkills() {
    if (!this.skillNames) {
      const prefix = `${this.storageBase}:skills:`;
      const keys = await getPromptStorage().getKeys(prefix);
      const names = new Set<string>();
      for (const key of keys) {
        if (key.startsWith(prefix)) {
          const skillName = key.slice(prefix.length).split(":")[0];
          if (skillName) names.add(skillName);
        }
      }
      this.skillNames = [...names].sort();
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

  /** Parse a single SKILL.md file from storage. */
  private async loadSkillFile(skillName: string) {
    const matter = (await import("gray-matter")).default;
    const raw = await getPromptStorage().getItem<string>(
      `${this.storageBase}:skills:${skillName}:SKILL.md`,
    );
    if (!raw) throw new MetaError("Skill file not found", { skillName });
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
  async resolveSystemPrompt(storageKey: string) {
    const template = await getPromptStorage().getItem<string>(storageKey);
    if (!template) throw new MetaError("Prompt not found", { storageKey });
    const metadata = await this.getSkillMetadata();
    return template.replace("{{SKILL_METADATA}}", metadata);
  }
}
