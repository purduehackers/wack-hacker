import { expect, test } from "bun:test";

import { z } from "zod";

import { runEntryCall } from "../../node_modules/eve/dist/src/harness/execute-call.js";
import type { HarnessToolDefinition } from "../../node_modules/eve/dist/src/harness/execute-tool.js";

test("both flag branches cover the root and every specialist without changing native tool semantics", async () => {
  for (const enabled of ["true", "false", undefined]) {
    const child = Bun.spawn(
      [process.execPath, new URL("./sandbox-tool-selection.ts", import.meta.url).pathname],
      {
        env: {
          ...(enabled === undefined ? {} : { DURABLE_BASH_ENABLED: enabled }),
          AGENT_INGRESS_SECRET: "test-only",
          BOT_INGRESS_SECRET: "test-only",
          BOT_URL: "http://127.0.0.1:1",
          TURSO_DATABASE_URL: "file::memory:",
          REDIS_URL: "redis://127.0.0.1:1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    expect(error).toBe("");
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toEqual({ enabled: enabled === "true", agents: 13 });
  }
});

test("installed Eve never executes a Workflow tool during replayed model attempts with new call IDs", () => {
  let executions = 0;
  const definition: HarnessToolDefinition = {
    name: "bash",
    description: "checkpointed command",
    inputSchema: z.strictObject({ command: z.string() }),
    workflowId: "workflow//./agent/lib/sandbox/executeBash//executeBash",
    execute: () => {
      executions += 1;
    },
  };
  for (const toolCallId of ["provider-attempt-one", "provider-attempt-two"]) {
    const output = runEntryCall(
      {
        definition,
        call: { toolName: "bash", input: { command: "printf event >> replay.log" } },
      },
      { toolCallId, messages: [] },
    );
    expect(output).toEqual({ dispatched: true });
  }
  expect(executions).toBe(0);
});
