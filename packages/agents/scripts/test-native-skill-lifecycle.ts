/// <reference types="node" />

import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { UserRole } from "@repo/shared/discord";
import { z } from "zod";

import { resolveIntegrationSkills } from "../agent/lib/policy/skill-catalog.ts";
import { LINEAR_SKILL_DEFINITIONS } from "../agent/subagents/linear/skills/catalog.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const organizer = {
  authenticator: "native-skill-lifecycle",
  principalType: "user",
  principalId: "10000000000000000",
  attributes: { role: UserRole.Organizer },
} as const;
const issueSkill = resolveIntegrationSkills(organizer, LINEAR_SKILL_DEFINITIONS)["issues"];
if (issueSkill === undefined) throw new Error("Linear issues skill is not organizer-visible");
const fixtureRoot = await mkdtemp(join(tmpdir(), "wack-native-skill-lifecycle-"));

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
  await mkdir(join(fixtureRoot, "agent", "skills"), { recursive: true });
  await mkdir(join(fixtureRoot, "evals"), { recursive: true });
  await symlink(join(packageRoot, "node_modules"), join(fixtureRoot, "node_modules"), "dir");

  await Bun.write(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify({ name: "wack-native-skill-lifecycle", private: true, type: "module" }, undefined, 2)}
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
      ? { toolCalls: [{ name: "load_skill", input: { skill: "issues" } }] }
      : \`RESULT=\${String(toolResults.at(-1)?.output)}\`,
  ),
});
`,
  );
  await Bun.write(
    join(fixtureRoot, "agent", "instructions.md"),
    `Call load_skill once on every turn.
`,
  );
  await Bun.write(
    join(fixtureRoot, "agent", "skills", "catalog.ts"),
    `import { defineDynamic, defineSkill } from "eve/skills";

let turn = 0;
const issue = ${JSON.stringify(issueSkill, undefined, 2)} as const;

export default defineDynamic({
  events: {
    // The real catalogs' role tests prove a downgrade returns {}. This counter
    // isolates Eve's compiled package-removal behavior from application auth.
    "turn.started": () => (turn++ >= 2 ? {} : { issues: defineSkill(issue) }),
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
    await t.send("Load the Linear issues skill.");
    await t.send("Load it again on this preserved session.");
    await t.send("Try the old name after an authority downgrade.");
    t.succeeded();
    t.loadedSkill("issues", { count: 2, output: /## When to use/ });
    t.calledTool("load_skill", { count: 1, status: "failed", output: /No skill named/ });
    t.check(t.reply, includes('No skill named "issues"'));
  },
});
`,
  );

  const infoOutput = await runEve("info", "--json");
  const info = z
    .object({ artifacts: z.object({ compiledManifest: z.string() }) })
    .parse(JSON.parse(infoOutput.slice(infoOutput.indexOf("{"))));
  const manifest = z
    .object({
      dynamicSkills: z.array(z.object({ eventNames: z.array(z.string()) })),
    })
    .parse(await Bun.file(info.artifacts.compiledManifest).json());
  if (
    manifest.dynamicSkills.length !== 1 ||
    manifest.dynamicSkills[0]?.eventNames[0] !== "turn.started"
  ) {
    throw new Error("fixture did not compile its turn.started skill catalog");
  }

  const evalOutput = await runEve("eval", "lifecycle", "--skip-report", "--timeout", "60000");
  if (!evalOutput.includes('opening sandbox session "root" on backend')) {
    throw new Error("Eve did not provision its default sandbox backend");
  }
  if (!evalOutput.includes("gates 4/4") || !evalOutput.includes("Results: 1 passed")) {
    throw new Error(`native skill lifecycle gates were not reported
${evalOutput}`);
  }
  console.info(
    "native skill lifecycle: compiled discovery, default sandbox, repeated load, and downgrade removal passed",
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
