/// <reference types="node" />

import { createHash } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { z } from "zod";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const agentRoot = join(packageRoot, "agent");
const parityPath = join(packageRoot, "feature-parity.json");

const skillDefinitionSchema = z.strictObject({
  name: z.string().min(1),
  minRole: z.enum(["public", "organizer", "admin"]),
  description: z.string().min(1),
  criteria: z.string().min(1),
  tools: z.array(z.string()),
  instructions: z.string().min(1),
});
const paritySkillSchema = skillDefinitionSchema.omit({ instructions: true }).extend({
  instructionsDigest: z.string().regex(/^[0-9a-f]{64}$/u),
});
const parityDomainSchema = z.strictObject({
  name: z.string(),
  baseTools: z.array(z.string()),
  skills: z.array(paritySkillSchema),
  tools: z.array(z.string()),
});
const parityManifestSchema = z.strictObject({
  schemaVersion: z.literal(3),
  generatedBy: z.literal("scripts/check-feature-parity.ts"),
  domains: z.array(parityDomainSchema),
  subagents: z.array(z.string()),
  auxiliarySubagents: z.array(z.string()),
  totals: z.strictObject({
    domains: z.number().int().nonnegative(),
    tools: z.number().int().nonnegative(),
    skills: z.number().int().nonnegative(),
    subagents: z.number().int().nonnegative(),
  }),
});
type ParityManifest = z.infer<typeof parityManifestSchema>;

function serialize(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}
`;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function digest(instructions: string): string {
  return createHash("sha256").update(instructions.replaceAll("\r\n", "\n").trim()).digest("hex");
}

function assertUnique(label: string, entries: readonly string[]): void {
  const repeated = entries.filter((entry, index) => entries.indexOf(entry) !== index);
  if (repeated.length > 0) throw new Error(`${label} contains duplicates: ${repeated.join(",")}`);
}

function constantName(domain: string): string {
  return domain.toUpperCase().replaceAll("-", "_");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function subagentNames(): Promise<string[]> {
  const subagentsRoot = join(agentRoot, "subagents");
  const discoveredSubagents = (await readdir(subagentsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  for (const subagent of discoveredSubagents) {
    for (const required of ["agent.ts", "instructions.md"]) {
      const path = join(subagentsRoot, subagent, required);
      if (!(await fileExists(path))) throw new Error(`${path} is required for a declared subagent`);
    }
  }
  return discoveredSubagents;
}

async function integrationDomains(subagents: readonly string[]): Promise<string[]> {
  const domains: string[] = [];
  for (const name of subagents) {
    const root = join(agentRoot, "subagents", name);
    const hasSkills = await fileExists(join(root, "skills/catalog.ts"));
    const hasTools = await fileExists(join(root, "lib/tool-registry.ts"));
    if (hasSkills !== hasTools) {
      throw new Error(`${name} must declare both a native skill catalog and tool registry`);
    }
    if (hasSkills) domains.push(name);
  }
  return domains;
}

async function domainCatalog(domain: string): Promise<z.infer<typeof parityDomainSchema>> {
  const root = join(agentRoot, "subagents", domain);
  const constant = constantName(domain);
  const skillModule = z
    .record(z.string(), z.unknown())
    .parse(await import(pathToFileURL(join(root, "skills/catalog.ts")).href));
  const registryModule = z
    .record(z.string(), z.unknown())
    .parse(await import(pathToFileURL(join(root, "lib/tool-registry.ts")).href));
  const baseTools = z.array(z.string()).parse(skillModule[`${constant}_BASE_TOOL_NAMES`]);
  const skillDefinitions = z
    .array(skillDefinitionSchema)
    .parse(skillModule[`${constant}_SKILL_DEFINITIONS`]);
  const tools = Object.keys(
    z.record(z.string(), z.unknown()).parse(registryModule[`${constant}_TOOLS`]),
  ).sort((left, right) => left.localeCompare(right));

  assertUnique(`${domain} base tools`, baseTools);
  assertUnique(
    `${domain} skill names`,
    skillDefinitions.map((definition) => definition.name),
  );
  assertUnique(`${domain} tools`, tools);
  const knownTools = new Set(tools);
  for (const [label, toolNames] of [
    ["base", baseTools],
    ...skillDefinitions.map((definition) => [definition.name, definition.tools] as const),
  ] as const) {
    assertUnique(`${domain}/${label} tools`, toolNames);
    const unknown = toolNames.filter((name) => !knownTools.has(name));
    if (unknown.length > 0) {
      throw new Error(`${domain}/${label} references unknown tools: ${unknown.join(",")}`);
    }
  }
  const coveredTools = new Set([
    ...baseTools,
    ...skillDefinitions.flatMap((definition) => definition.tools),
  ]);
  const uncovered = tools.filter((name) => !coveredTools.has(name));
  if (uncovered.length > 0) {
    throw new Error(`${domain} registry tools lack skill/base coverage: ${uncovered.join(",")}`);
  }

  return {
    name: domain,
    baseTools,
    skills: skillDefinitions.map(({ instructions, ...definition }) => ({
      ...definition,
      instructionsDigest: digest(instructions),
    })),
    tools,
  };
}

async function deriveParityManifest(): Promise<ParityManifest> {
  const subagents = await subagentNames();
  const domains = await integrationDomains(subagents);
  const domainCatalogs = await Promise.all(domains.map(domainCatalog));
  const auxiliarySubagents = subagents.filter((name) => !domains.includes(name));
  return parityManifestSchema.parse({
    schemaVersion: 3,
    generatedBy: "scripts/check-feature-parity.ts",
    domains: domainCatalogs,
    subagents,
    auxiliarySubagents,
    totals: {
      domains: domains.length,
      tools: domainCatalogs.reduce((total, entry) => total + entry.tools.length, 0),
      skills: domainCatalogs.reduce((total, entry) => total + entry.skills.length, 0),
      subagents: subagents.length,
    },
  });
}

const actual = await deriveParityManifest();
if (process.argv.includes("--write")) {
  await writeFile(parityPath, serialize(actual));
  console.info(`updated ${parityPath}`);
} else {
  const expected = parityManifestSchema.parse(JSON.parse(await readFile(parityPath, "utf8")));
  if (!same(actual, expected)) {
    throw new Error(
      `${parityPath} drifted from the native skill/tool/subagent sources. ` +
        `Review the change and run bun run parity:update if it is intentional.
` +
        `source-derived totals: ${JSON.stringify(actual.totals)}; ` +
        `committed totals: ${JSON.stringify(expected.totals)}`,
    );
  }
}

for (const domain of actual.domains) {
  console.info(`${domain.name}: ${domain.tools.length} tools / ${domain.skills.length} skills`);
}
console.info(
  `feature parity: ${actual.totals.domains} native domains, ${actual.totals.tools} tools, ` +
    `${actual.totals.skills} skills, ${actual.totals.subagents} subagents ` +
    `(${actual.auxiliarySubagents.join(", ")} auxiliary)`,
);
