import { describe, it, expect } from "vitest";

import { UserRole } from "@/lib/ai/constants";
import { TEST_SKILLS } from "@/lib/test/fixtures";

import { SkillRegistry } from "./registry.ts";

describe("SkillRegistry", () => {
  const registry = new SkillRegistry(TEST_SKILLS);

  describe("getAvailableSkills", () => {
    it("public sees only public skills", () => {
      const skills = registry.getAvailableSkills(UserRole.Public);
      expect(skills.map((s) => s.name)).toEqual(["scheduling"]);
    });

    it("organizer sees public + organizer skills", () => {
      const skills = registry.getAvailableSkills(UserRole.Organizer);
      expect(skills.map((s) => s.name)).toEqual(["scheduling", "linear"]);
    });

    it("admin sees all skills", () => {
      const skills = registry.getAvailableSkills(UserRole.Admin);
      expect(skills.map((s) => s.name)).toEqual(["scheduling", "linear", "admin_tools"]);
    });
  });

  describe("loadSkill", () => {
    it("returns skill bundle for accessible skill", () => {
      const skill = registry.loadSkill("scheduling", UserRole.Public);
      expect(skill).not.toBeNull();
      expect(skill!.instructions).toBe("Use cron expressions.");
    });

    it("returns null for skill above role level", () => {
      expect(registry.loadSkill("linear", UserRole.Public)).toBeNull();
    });

    it("returns null for unknown skill", () => {
      expect(registry.loadSkill("nonexistent", UserRole.Admin)).toBeNull();
    });
  });

  describe("buildSkillMenu", () => {
    it("generates formatted menu for role", () => {
      const menu = registry.buildSkillMenu(UserRole.Public);
      expect(menu).toContain("<available_skills>");
      expect(menu).toContain("scheduling: Schedule tasks");
      expect(menu).not.toContain("linear");
    });

    it("returns empty string when no skills available", () => {
      const empty = new SkillRegistry({});
      expect(empty.buildSkillMenu(UserRole.Admin)).toBe("");
    });
  });
});
