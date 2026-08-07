import { describe, expect, test } from "bun:test";

import { SUBAGENT_OUTPUT_SCHEMA } from "./subagent-output.ts";

const output = {
  summary: "Checked the requested records.",
  answer: "Two matching records were found.",
  entities: [
    {
      name: "Example",
      type: "record",
      id: "record-1",
      url: "https://example.com/record-1",
    },
  ],
};

describe("delegated specialist output", () => {
  test("is a strict, plain-JSON structured result", () => {
    const parsed = SUBAGENT_OUTPUT_SCHEMA.parse(output);
    // oxlint-disable-next-line oxclippy/prefer-structured-clone -- prove the boundary survives JSON serialization, not merely cloning.
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(output);
  });

  test("rejects fabricated non-URL entity locators and extra fields", () => {
    expect(
      SUBAGENT_OUTPUT_SCHEMA.safeParse({
        ...output,
        entities: [{ ...output.entities[0], url: "not-a-url" }],
      }).success,
    ).toBe(false);
    expect(SUBAGENT_OUTPUT_SCHEMA.safeParse({ ...output, hidden: true }).success).toBe(false);
  });
});
