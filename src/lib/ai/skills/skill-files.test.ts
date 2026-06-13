import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Belt-and-suspenders with scripts/compile-skills.ts: the compiler fails the
// build on these same invariants, but these tests catch them in `bun test`
// without requiring a compile run.

const SKILLS_DIR = import.meta.dirname;

function activeDirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "generated" && !e.name.startsWith("_"))
    .map((e) => e.name);
}

const topLevelDirs = activeDirs(SKILLS_DIR);

function allSkillFiles(): string[] {
  return topLevelDirs.flatMap((dir) => [
    join(SKILLS_DIR, dir, "SKILL.md"),
    ...activeDirs(join(SKILLS_DIR, dir, "skills")).map((sub) =>
      join(SKILLS_DIR, dir, "skills", sub, "SKILL.md"),
    ),
  ]);
}

describe("SKILL.md source files", () => {
  it("every delegate-mode top-level SKILL.md contains {{SKILL_MENU}}", () => {
    for (const dir of topLevelDirs) {
      const raw = readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf-8");
      if (!/^mode: delegate$/m.test(raw)) continue;
      expect(raw, `${dir}/SKILL.md`).toContain("{{SKILL_MENU}}");
    }
  });

  it("every delegate-mode top-level SKILL.md declares baseTools", () => {
    for (const dir of topLevelDirs) {
      const raw = readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf-8");
      if (!/^mode: delegate$/m.test(raw)) continue;
      expect(raw, `${dir}/SKILL.md`).toMatch(/^baseTools:/m);
    }
  });

  it('no SKILL.md references "load_skill" (the tool is named loadSkill)', () => {
    for (const file of allSkillFiles()) {
      const raw = readFileSync(file, "utf-8");
      expect(raw.includes("load_skill"), `${file} references load_skill`).toBe(false);
    }
  });
});
