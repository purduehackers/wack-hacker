import { describe, expect, test } from "bun:test";

import { analyzeSerializationBoundaries } from "./serialization-invariant.ts";

const imports = `
import { defineState } from "eve/context";
import { defineTool } from "eve/tools";
import { assertStateValue, guardToolExecution } from "./serialization.ts";
`;

describe("serialization boundary source invariant", () => {
  test("accepts guarded inline tool and state boundaries", () => {
    const analysis = analyzeSerializationBoundaries(`${imports}
      defineTool({
        execute: async () => guardToolExecution(async () => ({ ok: true })),
      });
      defineState("example", () => assertStateValue({ phase: "empty" }));
    `);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.toolExecutors).toBe(1);
    expect(analysis.stateInitializers).toBe(1);
  });

  test("accepts a block whose single outer return guards nested paths", () => {
    const analysis = analyzeSerializationBoundaries(`${imports}
      defineTool({
        async execute() {
          return guardToolExecution(async () => {
            if (Math.random() > 0.5) return { branch: "left" };
            return { branch: "right" };
          });
        },
      });
    `);
    expect(analysis.diagnostics).toEqual([]);
  });

  test("rejects unguarded or indirect defineTool outputs", () => {
    const analysis = analyzeSerializationBoundaries(`${imports}
      const execute = async () => ({ leaked: new Date() });
      defineTool({ execute });
      defineTool({ execute: async () => ({ leaked: new Map() }) });
    `);
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "found 2 defineTool calls but 1 inline execute functions",
      "defineTool execute must have one outer return through guardToolExecution",
    ]);
  });

  test("rejects an unguarded defineState initializer", () => {
    const analysis = analyzeSerializationBoundaries(`${imports}
      defineState("example", () => ({ createdAt: new Date() }));
    `);
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "defineState initializer must return directly through assertStateValue",
    ]);
  });

  test("rejects Eve namespace imports that could bypass the scan", () => {
    const analysis = analyzeSerializationBoundaries(`import * as tools from "eve/tools";
      tools.defineTool({ execute: async () => ({ ok: true }) });
    `);
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "namespace imports can bypass defineTool/defineState boundary analysis",
    ]);
  });
});
