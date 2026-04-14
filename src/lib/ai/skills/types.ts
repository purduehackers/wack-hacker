import type { UserRole } from "../constants.ts";

/** Lightweight metadata shown in the skill menu (system prompt). */
export interface SkillMeta {
  name: string;
  description: string;
  /** When the AI should load this skill. */
  criteria: string;
  /** Tool names that belong to this bundle. */
  toolNames: string[];
  /** Minimum role required to access this skill. */
  minRole: UserRole;
  /** "inline" activates tools on the top-level agent; "delegate" spawns a subagent. */
  mode: "inline" | "delegate";
}

/** Full skill definition including the instruction body. */
export interface SkillBundle extends SkillMeta {
  /** Detailed instructions (markdown body from SKILL.md). */
  instructions: string;
}
