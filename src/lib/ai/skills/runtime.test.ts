import { describe, expect, it } from "vitest";

import { UserRole } from "@/lib/ai/constants";
import { stepResult as step, TEST_SKILLS } from "@/lib/test/fixtures";

import { SkillRegistry } from "./registry.ts";
import { computeActiveTools } from "./runtime.ts";

const baseToolNames = ["loadSkill"] as const;
const registry = new SkillRegistry(TEST_SKILLS);

describe("computeActiveTools — empty / no-op cases", () => {
  it("returns undefined when no loadSkill calls appear in history", () => {
    const result = computeActiveTools({
      steps: [step([{ toolName: "search_entities" }])],
      registry,
      role: UserRole.Admin,
      baseToolNames,
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when steps are empty", () => {
    const result = computeActiveTools({
      steps: [],
      registry,
      role: UserRole.Admin,
      baseToolNames,
    });
    expect(result).toBeUndefined();
  });

  it("skips loadSkill calls without a name", () => {
    const result = computeActiveTools({
      steps: [step([{ toolName: "loadSkill", input: {} }])],
      registry,
      role: UserRole.Admin,
      baseToolNames,
    });
    expect(result).toBeUndefined();
  });
});

describe("computeActiveTools — activation", () => {
  it("activates the loaded skill's tools on top of the base set", () => {
    const result = computeActiveTools({
      steps: [step([{ toolName: "loadSkill", input: { name: "scheduling" } }])],
      registry,
      role: UserRole.Public,
      baseToolNames,
    });
    expect(result?.sort()).toEqual(["cancel_task", "loadSkill", "schedule_task"]);
  });

  it("merges tools from multiple loaded skills", () => {
    const result = computeActiveTools({
      steps: [
        step([{ toolName: "loadSkill", input: { name: "scheduling" } }]),
        step([{ toolName: "loadSkill", input: { name: "linear" } }]),
      ],
      registry,
      role: UserRole.Organizer,
      baseToolNames,
    });
    expect(result?.sort()).toEqual([
      "cancel_task",
      "createIssue",
      "loadSkill",
      "schedule_task",
      "searchIssues",
    ]);
  });

  it("dedupes when the same skill is loaded twice", () => {
    const result = computeActiveTools({
      steps: [
        step([{ toolName: "loadSkill", input: { name: "scheduling" } }]),
        step([{ toolName: "loadSkill", input: { name: "scheduling" } }]),
      ],
      registry,
      role: UserRole.Public,
      baseToolNames,
    });
    expect(result?.filter((t) => t === "schedule_task")).toHaveLength(1);
  });

  it("ignores non-loadSkill tool calls when computing the active set", () => {
    const result = computeActiveTools({
      steps: [
        step([
          { toolName: "search_entities" },
          { toolName: "loadSkill", input: { name: "scheduling" } },
          { toolName: "some_other_tool" },
        ]),
      ],
      registry,
      role: UserRole.Public,
      baseToolNames,
    });
    expect(result?.sort()).toEqual(["cancel_task", "loadSkill", "schedule_task"]);
  });
});

describe("computeActiveTools — role gating and custom mapping", () => {
  it("drops tools for skills the role cannot access", () => {
    const result = computeActiveTools({
      steps: [step([{ toolName: "loadSkill", input: { name: "admin_tools" } }])],
      registry,
      role: UserRole.Public,
      baseToolNames,
    });
    expect(result).toEqual(["loadSkill"]);
  });

  it("uses a custom skillToTools mapper when provided", () => {
    const result = computeActiveTools({
      steps: [step([{ toolName: "loadSkill", input: { name: "scheduling" } }])],
      registry,
      role: UserRole.Public,
      baseToolNames,
      skillToTools: (skill) => [`${skill.name}_only`],
    });
    expect(result?.sort()).toEqual(["loadSkill", "scheduling_only"]);
  });
});
