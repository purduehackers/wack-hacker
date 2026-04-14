import type { UserRole } from "../constants.ts";
import type { SkillBundle, SkillMeta } from "./types.ts";

const ROLE_LEVEL: Record<UserRole, number> = {
  public: 0,
  organizer: 1,
  admin: 2,
};

export class SkillRegistry {
  private readonly skills: Record<string, SkillBundle>;

  constructor(skills: Record<string, SkillBundle>) {
    this.skills = skills;
  }

  /** Skills the given role is allowed to see. */
  getAvailableSkills(role: UserRole): SkillMeta[] {
    const level = ROLE_LEVEL[role];
    return Object.values(this.skills).filter((s) => ROLE_LEVEL[s.minRole] <= level);
  }

  /** Load a specific skill, returning null if it doesn't exist or the role is insufficient. */
  loadSkill(name: string, role: UserRole): SkillBundle | null {
    const skill = this.skills[name];
    if (!skill) return null;
    if (ROLE_LEVEL[role] < ROLE_LEVEL[skill.minRole]) return null;
    return skill;
  }

  /** Format the skill menu for injection into a system prompt. */
  buildSkillMenu(role: UserRole): string {
    const skills = this.getAvailableSkills(role);
    if (skills.length === 0) return "";
    const lines = skills.map((s) => `- ${s.name}: ${s.description} (use when: ${s.criteria})`);
    return `<available_skills>\n${lines.join("\n")}\n</available_skills>`;
  }
}
