import type { UserRole } from "../constants.ts";

/** Lightweight metadata shown in the skill menu (system prompt). */
export interface SkillMeta {
  name: string;
  description: string;
  /** When the AI should load this skill. */
  criteria: string;
  /**
   * Cross-domain routing note for top-level delegate skills — tie-breakers
   * that don't fit `criteria` (e.g. the Vercel-vs-Sentry boundary). Rendered
   * into the orchestrator's generated delegate docs.
   */
  routing?: string;
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
