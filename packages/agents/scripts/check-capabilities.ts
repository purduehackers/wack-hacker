/// <reference types="node" />

/**
 * Cross-file invariants for the agent's capability surface.
 *
 * Every check here is a relationship *between* files, which is exactly what a
 * code review cannot see: each hunk reads as correct on its own and the defect
 * only exists in the pairing. A skill listing a tool the registry no longer
 * defines, or a registry tool no skill can reach, is a silent runtime failure —
 * the tool either fails to resolve or is undiscoverable by any role.
 *
 * Deriving the surface also imports all 22 skill catalogs and tool registries,
 * so a top-level throw in any of them fails here rather than at boot.
 *
 * This deliberately does NOT snapshot the surface. A `minRole` or instruction
 * change is one line in `skills/catalog.ts` and shows up in the diff on its own;
 * pinning a generated copy of it only adds a second file to update and invites
 * regenerating past the very change the pin was meant to surface.
 */

import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UserRole } from "@repo/shared/discord";
import { z } from "zod";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const agentRoot = join(packageRoot, "agent");

const skillDefinitionSchema = z.strictObject({
  name: z.string().trim().min(1),
  minRole: z.enum(UserRole),
  description: z.string().trim().min(1),
  criteria: z.string().trim().min(1),
  tools: z.array(z.string()),
  instructions: z.string().trim().min(1),
});

interface DomainSurface {
  readonly name: string;
  readonly toolCount: number;
  readonly skillCount: number;
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

/** A subagent directory is only complete with both an agent and its instructions. */
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

/** Skills and a tool registry are meaningless apart: one resolves against the other. */
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

async function checkDomain(domain: string): Promise<DomainSurface> {
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
  );

  assertUnique(`${domain} base tools`, baseTools);
  assertUnique(
    `${domain} skill names`,
    skillDefinitions.map((definition) => definition.name),
  );
  assertUnique(`${domain} tools`, tools);

  // Every referenced tool must exist…
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

  // …and every defined tool must be reachable by some role.
  const coveredTools = new Set([
    ...baseTools,
    ...skillDefinitions.flatMap((definition) => definition.tools),
  ]);
  const uncovered = tools.filter((name) => !coveredTools.has(name));
  if (uncovered.length > 0) {
    throw new Error(`${domain} registry tools lack skill/base coverage: ${uncovered.join(",")}`);
  }

  return { name: domain, toolCount: tools.length, skillCount: skillDefinitions.length };
}

const subagents = await subagentNames();
const domains = await integrationDomains(subagents);
const surfaces = await Promise.all(domains.map(checkDomain));
const auxiliary = subagents.filter((name) => !domains.includes(name));

for (const surface of surfaces) {
  console.info(`${surface.name}: ${surface.toolCount} tools / ${surface.skillCount} skills`);
}
console.info(
  `capabilities: ${domains.length} native domains, ` +
    `${surfaces.reduce((total, surface) => total + surface.toolCount, 0)} tools, ` +
    `${surfaces.reduce((total, surface) => total + surface.skillCount, 0)} skills, ` +
    `${subagents.length} subagents (${auxiliary.join(", ")} auxiliary)`,
);
