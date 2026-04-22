import { describe, it, expect } from "vitest";

import { UserRole } from "@/lib/ai/constants";
import { TEST_SKILLS } from "@/lib/test/fixtures";

import { createLoadSkillTool } from "./loader.ts";
import { SkillRegistry } from "./registry.ts";

describe("createLoadSkillTool", () => {
  const registry = new SkillRegistry(TEST_SKILLS);

  it("returns skill instructions when accessible", async () => {
    const tool = createLoadSkillTool(registry, UserRole.Public);
    const result = await tool.execute!({ name: "scheduling" }, {} as never);
    expect(result).toContain('<skill name="scheduling">');
    expect(result).toContain("Use cron expressions.");
    expect(result).toContain("scheduleTask, cancelTask");
  });

  it("returns error for inaccessible skill", async () => {
    const tool = createLoadSkillTool(registry, UserRole.Public);
    const result = await tool.execute!({ name: "linear" }, {} as never);
    expect(result).toContain('Unknown skill "linear"');
    expect(result).toContain("Available: scheduling");
  });

  it("returns error for unknown skill", async () => {
    const tool = createLoadSkillTool(registry, UserRole.Admin);
    const result = await tool.execute!({ name: "nonexistent" }, {} as never);
    expect(result).toContain('Unknown skill "nonexistent"');
  });

  it("organizer can load organizer-level skill", async () => {
    const tool = createLoadSkillTool(registry, UserRole.Organizer);
    const result = await tool.execute!({ name: "linear" }, {} as never);
    expect(result).toContain('<skill name="linear">');
    expect(result).toContain("You are a Linear agent.");
  });

  it('renders "none" when a skill has no tools (delegate skills often have empty toolNames)', async () => {
    const emptyRegistry = new SkillRegistry({
      empty: {
        name: "empty",
        description: "No tools",
        criteria: "Never",
        toolNames: [],
        minRole: UserRole.Public,
        mode: "delegate",
        instructions: "Empty skill body.",
      },
    });
    const tool = createLoadSkillTool(emptyRegistry, UserRole.Public);
    const result = await tool.execute!({ name: "empty" }, {} as never);
    expect(result).toContain("<tools>none</tools>");
  });
});
