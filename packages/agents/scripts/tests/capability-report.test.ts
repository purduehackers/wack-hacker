import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { checkMigrationParity, readMigrationBaseline } from "../lib/capability-baseline.ts";

const repositoryRoot = new URL("../../../../", import.meta.url);
const reportSchema = z.looseObject({
  readiness: z.looseObject({
    configuration: z.literal("unverified"),
    providerPermissions: z.literal("unverified"),
    integrationValidation: z.literal("unverified"),
  }),
  summary: z.looseObject({ domains: z.int(), tools: z.int(), skills: z.int() }),
  collisions: z.looseObject({
    tools: z.array(z.looseObject({ name: z.string(), ids: z.array(z.string()) })),
    skills: z.array(z.looseObject({ name: z.string(), ids: z.array(z.string()) })),
  }),
  domains: z.array(
    z.looseObject({
      name: z.string(),
      entryRole: z.string(),
      baseTools: z.array(z.string()),
      tools: z.array(
        z.looseObject({
          id: z.string(),
          source: z.string(),
          toolRole: z.string(),
          admittedRole: z.string(),
        }),
      ),
      skills: z.array(
        z.looseObject({ id: z.string(), source: z.string(), tools: z.array(z.string()) }),
      ),
    }),
  ),
});

async function reportFromFreshProcess(): Promise<string> {
  const child = Bun.spawn(
    [process.execPath, "packages/agents/scripts/report-capabilities.ts", "--json"],
    {
      cwd: fileURLToPath(repositoryRoot),
      env: { ...process.env, SKIP_ENV_VALIDATION: "1" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Capability report failed: ${stderr}`);
  return stdout;
}

test("full registry inventory is deterministic, complete, namespaced, and honest about readiness", async () => {
  const first = await reportFromFreshProcess();
  expect(await reportFromFreshProcess()).toBe(first);
  const report = reportSchema.parse(JSON.parse(first));
  expect(report.summary.domains).toBeGreaterThanOrEqual(12);
  expect(report.summary.tools).toBeGreaterThanOrEqual(670);
  expect(report.summary.skills).toBeGreaterThanOrEqual(106);
  const baseline = await readMigrationBaseline();
  expect(baseline.domains).toHaveLength(12);
  expect(baseline.domains.flatMap((domain) => domain.skills)).toHaveLength(106);
  expect(
    new Set(
      baseline.domains.flatMap((domain) => [
        ...domain.baseTools,
        ...domain.skills.flatMap((skill) => skill.tools),
      ]),
    ).size,
  ).toBe(670);
  checkMigrationParity(report.domains, baseline);

  expect(report.collisions.tools.length).toBeGreaterThanOrEqual(41);
  expect(report.collisions.skills.length).toBeGreaterThanOrEqual(10);
  expect(report.collisions.tools.find((entry) => entry.name === "create_event")?.ids).toEqual([
    "cms__create_event",
    "discord__create_event",
  ]);
  const operations = report.domains.flatMap((domain) => domain.tools);
  expect(new Set(operations.map((tool) => tool.id)).size).toBe(operations.length);
  expect(operations.find((tool) => tool.id === "discord__get_server_info")).toMatchObject({
    toolRole: "public",
    admittedRole: "organizer",
  });
  expect(report.domains.every((domain) => domain.entryRole === "organizer")).toBe(true);
  for (const entry of [...operations, ...report.domains.flatMap((domain) => domain.skills)]) {
    expect(entry.source.startsWith("packages/agents/agent/subagents/")).toBe(true);
    expect(await Bun.file(new URL(entry.source, repositoryRoot)).exists()).toBe(true);
  }
}, 15_000);
