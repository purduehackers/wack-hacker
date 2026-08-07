import { describe, expect, test } from "bun:test";

import type { ModelMessage } from "ai";

import { LINEAR_BASE_TOOL_NAMES, LINEAR_SKILLS } from "./skills.generated.ts";
import { extractLoadedLinearSkills, progressiveLinearToolNames } from "./skills.ts";

const loadedIssuesHistory = [
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "load_skill",
        output: { type: "json", value: { activation: "linear.skill.loaded:issues" } },
      },
    ],
  },
] satisfies ModelMessage[];

describe("Linear progressive disclosure", () => {
  test("starts with exactly the four discovery tools", () => {
    expect(progressiveLinearToolNames([])).toEqual([...LINEAR_BASE_TOOL_NAMES]);
  });

  test("loads only tools belonging to a durable skill activation", () => {
    const issues = LINEAR_SKILLS.find(({ name }) => name === "issues");
    expect(issues).toBeDefined();
    expect(extractLoadedLinearSkills(loadedIssuesHistory)).toEqual(["issues"]);
    expect(progressiveLinearToolNames(loadedIssuesHistory)).toEqual([
      ...LINEAR_BASE_TOOL_NAMES,
      ...(issues?.toolNames ?? []),
    ]);
  });

  test("ignores arbitrary tool output that resembles a skill name", () => {
    const history = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "search_entities",
            output: { type: "json", value: { activation: "linear.skill.loaded:issues" } },
          },
        ],
      },
    ] satisfies ModelMessage[];
    expect(progressiveLinearToolNames(history)).toEqual([...LINEAR_BASE_TOOL_NAMES]);
  });
});
