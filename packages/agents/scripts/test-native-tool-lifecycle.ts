/// <reference types="node" />

import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = await mkdtemp(join(tmpdir(), "wack-native-tool-lifecycle-"));
const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
for (const name of [
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_API_TOKEN",
  "FORCE_COLOR",
]) {
  delete environment[name];
}

async function runEve(...arguments_: string[]): Promise<string> {
  const child = Bun.spawn([join(packageRoot, "node_modules/.bin/eve"), ...arguments_], {
    cwd: fixtureRoot,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`eve ${arguments_.join(" ")} failed (${exitCode})
${stdout}
${stderr}`);
  }
  return stdout;
}

try {
  await mkdir(join(fixtureRoot, "agent", "lib"), { recursive: true });
  await mkdir(join(fixtureRoot, "agent", "tools"), { recursive: true });
  await mkdir(join(fixtureRoot, "evals"), { recursive: true });
  await symlink(join(packageRoot, "node_modules"), join(fixtureRoot, "node_modules"), "dir");

  await Bun.write(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify({ name: "wack-native-tool-lifecycle", private: true, type: "module" }, undefined, 2)}
`,
  );
  await Bun.write(
    join(fixtureRoot, "agent", "agent.ts"),
    `import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

export default defineAgent({
  modelContextWindowTokens: 32_000,
  model: mockModel(({ toolResults, userMessageCount }) =>
    toolResults.length < userMessageCount
      ? { toolCalls: [{ name: "probe", input: { turn: userMessageCount } }] }
      : \`RESULT=\${JSON.stringify(toolResults.at(-1)?.output)}\`,
  ),
});
`,
  );
  await Bun.write(
    join(fixtureRoot, "agent", "instructions.md"),
    `Call probe once per turn.
`,
  );
  await Bun.write(
    join(fixtureRoot, "agent", "lib", "runtime.ts"),
    `export const PROBE_RUNTIME = {
  executeTool: async (name: string, input: { turn: number }) => ({ name, turn: input.turn }),
};
`,
  );
  await Bun.write(
    join(fixtureRoot, "agent", "lib", "serialization.ts"),
    `export async function guardToolExecution<T>(operation: () => Promise<T>): Promise<T> {
  return await operation();
}
`,
  );
  await Bun.write(
    join(fixtureRoot, "agent", "tools", "catalog.ts"),
    `import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { PROBE_RUNTIME } from "../lib/runtime.ts";
import { guardToolExecution } from "../lib/serialization.ts";

export default defineDynamic({
  events: {
    "step.started": () => ({
      probe: defineTool({
        description: "Return the current turn number.",
        inputSchema: z.object({ turn: z.number() }),
        execute: async (input) =>
          guardToolExecution(async () => await PROBE_RUNTIME.executeTool("probe", input)),
      }),
    }),
  },
});
`,
  );
  await Bun.write(
    join(fixtureRoot, "evals", "evals.config.ts"),
    `import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({});
`,
  );
  await Bun.write(
    join(fixtureRoot, "evals", "lifecycle.eval.ts"),
    `import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  async test(t) {
    await t.send("Run the probe for turn one.");
    await t.send("Run the reconstructed probe for turn two.");
    t.succeeded();
    t.calledTool("probe", { count: 2, status: "completed" });
    t.check(t.reply, includes('"turn":2'));
  },
});
`,
  );

  const infoOutput = await runEve("info", "--json");
  const info = z
    .object({ artifacts: z.object({ compiledManifest: z.string() }) })
    .parse(JSON.parse(infoOutput.slice(infoOutput.indexOf("{"))));
  const manifest = z
    .object({ dynamicTools: z.array(z.object({ eventNames: z.array(z.string()) })) })
    .parse(await Bun.file(info.artifacts.compiledManifest).json());
  if (
    manifest.dynamicTools.length !== 1 ||
    manifest.dynamicTools[0]?.eventNames[0] !== "step.started"
  ) {
    throw new Error("fixture did not compile its step.started tool catalog");
  }

  const evalOutput = await runEve("eval", "lifecycle", "--skip-report", "--timeout", "60000");
  if (!evalOutput.includes("gates 3/3") || !evalOutput.includes("Results: 1 passed")) {
    throw new Error(`native tool lifecycle gates were not reported
${evalOutput}`);
  }
  console.info(
    "native tool lifecycle: compiled discovery and two-step inline executor reconstruction passed",
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
