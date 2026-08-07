/// <reference types="node" />

import { createHash } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  agentRoot,
  buildDomainSkillManifest,
  compiledSkillSchema,
  listSkillDomains,
  packageRoot,
} from "./skill-manifest.ts";

const paritySkillSchema = z.strictObject({
  name: z.string(),
  minRole: z.enum(["public", "organizer", "admin"]),
  description: z.string().min(1),
  criteria: z.string().min(1),
  tools: z.array(z.string()),
  instructionsDigest: z.string().regex(/^[0-9a-f]{64}$/u),
});
const parityDomainSchema = z.strictObject({
  name: z.string(),
  sourceName: z.string(),
  baseTools: z.array(z.string()),
  skills: z.array(paritySkillSchema),
  tools: z.array(z.string()),
});
const parityManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  generatedBy: z.literal("scripts/check-feature-parity.ts"),
  domains: z.array(parityDomainSchema),
  subagents: z.array(z.string()),
  auxiliarySubagents: z.array(z.string()),
  totals: z.strictObject({
    generatedDomains: z.number().int().nonnegative(),
    generatedTools: z.number().int().nonnegative(),
    skillSources: z.number().int().nonnegative(),
    subagents: z.number().int().nonnegative(),
  }),
});
type ParityManifest = z.infer<typeof parityManifestSchema>;

const parityPath = join(packageRoot, "feature-parity.json");

function serialize(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
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

async function assertGeneratedManifest(
  domain: string,
  baseToolNames: readonly string[],
  skills: readonly z.infer<typeof compiledSkillSchema>[],
): Promise<void> {
  const generatedPath = join(agentRoot, "subagents", domain, "lib/skills.generated.ts");
  const generatedModule = z
    .record(z.string(), z.unknown())
    .parse(await import(pathToFileURL(generatedPath).href));
  const constant = constantName(domain);
  const generatedBaseTools = z
    .array(z.string())
    .parse(generatedModule[`${constant}_BASE_TOOL_NAMES`]);
  const generatedSkills = z.array(compiledSkillSchema).parse(generatedModule[`${constant}_SKILLS`]);
  if (!same(generatedBaseTools, baseToolNames) || !same(generatedSkills, skills)) {
    throw new Error(
      `${generatedPath} does not match its canonical skill sources; run bun run compile:skills`,
    );
  }
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
  const names = (await readdir(subagentsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  for (const subagentName of names) {
    for (const required of ["agent.ts", "instructions.md"]) {
      const path = join(subagentsRoot, subagentName, required);
      if (!(await fileExists(path))) throw new Error(`${path} is required for a declared subagent`);
    }
  }
  return names;
}

async function registryDomainNames(subagents: readonly string[]): Promise<string[]> {
  const registryDomains: string[] = [];
  for (const subagentName of subagents) {
    if (await fileExists(join(agentRoot, "subagents", subagentName, "lib/tool-registry.ts"))) {
      registryDomains.push(subagentName);
    }
  }
  return registryDomains;
}

async function deriveParityManifest(): Promise<ParityManifest> {
  const skillDomainNames = await listSkillDomains();
  const subagents = await subagentNames();
  const registryDomains = await registryDomainNames(subagents);
  if (!same(skillDomainNames, registryDomains)) {
    throw new Error(
      `skill source domains and generated tool registries differ: ` +
        `skills=[${skillDomainNames.join(",")}], registries=[${registryDomains.join(",")}]`,
    );
  }

  const capabilityCatalogs = [];
  for (const domainName of skillDomainNames) {
    const manifest = await buildDomainSkillManifest(domainName);
    await assertGeneratedManifest(domainName, manifest.baseToolNames, manifest.skills);
    assertUnique(`${domainName} base tools`, manifest.baseToolNames);
    assertUnique(
      `${domainName} skill names`,
      manifest.skills.map((skill) => skill.name),
    );
    for (const skill of manifest.skills) {
      assertUnique(`${domainName}/${skill.name} tools`, skill.toolNames);
      if (skill.instructions.trim() === "") {
        throw new Error(`${domainName}/${skill.name} instructions are empty`);
      }
    }
    capabilityCatalogs.push({
      name: manifest.domain,
      sourceName: manifest.sourceName,
      baseTools: [...manifest.baseToolNames],
      skills: manifest.skills.map((skill) => ({
        name: skill.name,
        minRole: skill.minRole,
        description: skill.description,
        criteria: skill.criteria,
        tools: [...skill.toolNames],
        instructionsDigest: digest(skill.instructions),
      })),
      tools: [...manifest.toolNames],
    });
  }
  const auxiliarySubagents = subagents.filter((name) => !skillDomainNames.includes(name));
  return parityManifestSchema.parse({
    schemaVersion: 2,
    generatedBy: "scripts/check-feature-parity.ts",
    domains: capabilityCatalogs,
    subagents,
    auxiliarySubagents,
    totals: {
      generatedDomains: skillDomainNames.length,
      generatedTools: capabilityCatalogs.reduce(
        (total, catalog) => total + catalog.tools.length,
        0,
      ),
      skillSources: capabilityCatalogs.reduce((total, catalog) => total + catalog.skills.length, 0),
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
      `${parityPath} drifted from the canonical skill/tool/subagent sources. ` +
        `Review the change and run bun run parity:update if it is intentional.\n` +
        `source-derived totals: ${JSON.stringify(actual.totals)}; ` +
        `committed totals: ${JSON.stringify(expected.totals)}`,
    );
  }
}

for (const domain of actual.domains) {
  console.info(`${domain.name}: ${domain.tools.length} tools / ${domain.skills.length} skills`);
}
console.info(
  `feature parity: ${actual.totals.generatedDomains} generated domains, ` +
    `${actual.totals.generatedTools} tools, ${actual.totals.skillSources} skill sources, ` +
    `${actual.totals.subagents} subagents (${actual.auxiliarySubagents.join(", ")} auxiliary)`,
);
