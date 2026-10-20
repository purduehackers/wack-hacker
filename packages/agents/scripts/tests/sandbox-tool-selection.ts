import { readdir } from "node:fs/promises";

import { isDisabledToolSentinel } from "eve/tools";
import { bash } from "eve/tools/bash";
import { writeFile } from "eve/tools/write_file";
import { z } from "zod";

import { isWorkflowToolDefinition } from "../../node_modules/eve/dist/src/tools/workflow-definition.js";

const enabled = process.env["DURABLE_BASH_ENABLED"] === "true";
const root = new URL("../../agent/", import.meta.url);
const directories = [
  "",
  ...(await readdir(new URL("subagents/", root))).map((name) => `subagents/${name}/`),
];
for (const directory of directories) {
  const load = async (slot: string): Promise<unknown> => {
    const module: { default: unknown } = await import(
      new URL(`${directory}tools/${slot}.ts`, root).href
    );
    return module.default;
  };
  const shell = await load("bash");
  const writer = await load("write_file");
  const opener = await load("workspace_open");
  if (enabled) {
    if (
      !isWorkflowToolDefinition(shell) ||
      !isWorkflowToolDefinition(writer) ||
      isDisabledToolSentinel(opener)
    )
      throw new Error("Candidate tools must use Workflow calls and expose initialization");
    const definition = z
      .object({
        execute: z.function({ input: [z.unknown(), z.unknown()], output: z.promise(z.json()) }),
      })
      .parse(opener);
    let initializations = 0;
    const result = await definition.execute(
      {},
      {
        getSandbox: async () => {
          initializations += 1;
          return {};
        },
      },
    );
    if (initializations !== 1 || !z.object({ ready: z.literal(true) }).safeParse(result).success)
      throw new Error("workspace_open must delegate once to Eve's normal provider lifecycle");
  } else if (shell !== bash || writer !== writeFile || !isDisabledToolSentinel(opener)) {
    throw new Error("Native tools must retain their original definitions without workspace_open");
  }
}
process.stdout.write(JSON.stringify({ enabled, agents: directories.length }));
