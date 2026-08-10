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
 * Deriving the surface also imports every registry, so a top-level throw in any
 * of them fails here rather than at boot.
 *
 * This deliberately does NOT snapshot the surface. A `minRole` change is one
 * line in a registry and shows up in the diff on its own; pinning a generated
 * copy of it only adds a second file to update and invites regenerating past
 * the very change the pin was meant to surface.
 */

import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UserRole } from "@repo/shared/discord";
import { z } from "zod";

import { normalizeReadme, renderSubagentReadme, type SkillDoc } from "./lib/subagent-readme.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const agentRoot = join(packageRoot, "agent");

/** The legacy shape: prose inline in `skills/catalog.ts`. */
const legacySkillSchema = z.strictObject({
  name: z.string().trim().min(1),
  minRole: z.enum(UserRole),
  description: z.string().trim().min(1),
  criteria: z.string().trim().min(1),
  tools: z.array(z.string()),
  instructions: z.string().trim().min(1),
});

/** The current shape: policy in `lib/registry.ts`, prose in `skills/<name>.md`. */
const registrySkillSchema = z.strictObject({
  name: z.string().trim().min(1),
  minRole: z.enum(UserRole),
  tools: z.array(z.string()),
});

const accessSchema = z.looseObject({
  risk: z.string(),
  minRole: z.enum(UserRole).optional(),
});
const toolSpecSchema = z.looseObject({
  description: z.string().trim().min(1),
  access: accessSchema,
});

interface DomainSurface {
  readonly name: string;
  readonly toolCount: number;
  readonly skillCount: number;
  readonly converted: boolean;
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
    const converted = await fileExists(join(root, "lib/registry.ts"));
    const hasSkills = converted || (await fileExists(join(root, "skills/catalog.ts")));
    const hasTools = converted || (await fileExists(join(root, "lib/tool-registry.ts")));
    if (hasSkills !== hasTools) {
      throw new Error(`${name} must declare both a native skill catalog and tool registry`);
    }
    if (hasSkills) domains.push(name);
  }
  return domains;
}

/** Frontmatter `description` plus the body, for one `skills/<name>.md`. */
async function readSkillDoc(root: string, name: string): Promise<{ description: string }> {
  const path = join(root, "skills", `${name}.md`);
  if (!(await fileExists(path))) {
    throw new Error(`${path} is required: every registry skill needs its prose`);
  }
  const source = await readFile(path, "utf8");
  const description = /^---\n(?:.*\n)*?description:[ \t]*(.+)\n(?:.*\n)*?---\n/u.exec(source)?.[1];
  if (description === undefined || description.trim() === "") {
    throw new Error(`${path} needs a non-empty \`description\` in its frontmatter`);
  }
  return { description: description.trim() };
}

/** Every `.md` in `skills/` must be claimed by the registry, and vice versa. */
async function skillDocNames(root: string): Promise<string[]> {
  const dir = join(root, "skills");
  if (!(await fileExists(dir))) return [];
  return (await readdir(dir))
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.slice(0, -3))
    .sort((left, right) => left.localeCompare(right));
}

async function checkDomain(domain: string): Promise<DomainSurface> {
  const root = join(agentRoot, "subagents", domain);
  const constant = constantName(domain);
  const converted = await fileExists(join(root, "lib/registry.ts"));

  const modulePath = converted ? "lib/registry.ts" : "skills/catalog.ts";
  const skillModule = z
    .record(z.string(), z.unknown())
    .parse(await import(pathToFileURL(join(root, modulePath)).href));
  const registryModule = converted
    ? skillModule
    : z
        .record(z.string(), z.unknown())
        .parse(await import(pathToFileURL(join(root, "lib/tool-registry.ts")).href));

  const baseTools = z.array(z.string()).parse(skillModule[`${constant}_BASE_TOOL_NAMES`]);
  const toolSpecs = z.record(z.string(), toolSpecSchema).parse(registryModule[`${constant}_TOOLS`]);
  const tools = Object.keys(toolSpecs);

  const skills = converted
    ? z.array(registrySkillSchema).parse(skillModule[`${constant}_SKILLS`])
    : z.array(legacySkillSchema).parse(skillModule[`${constant}_SKILL_DEFINITIONS`]);

  assertUnique(`${domain} base tools`, baseTools);
  assertUnique(
    `${domain} skill names`,
    skills.map((entry) => entry.name),
  );
  assertUnique(`${domain} tools`, tools);

  // Every referenced tool must exist…
  const knownTools = new Set(tools);
  for (const [label, toolNames] of [
    ["base", baseTools],
    ...skills.map((entry) => [entry.name, entry.tools] as const),
  ] as const) {
    assertUnique(`${domain}/${label} tools`, toolNames);
    const unknown = toolNames.filter((name) => !knownTools.has(name));
    if (unknown.length > 0) {
      throw new Error(`${domain}/${label} references unknown tools: ${unknown.join(",")}`);
    }
  }

  // …and every defined tool must be reachable by some role.
  const coveredTools = new Set([...baseTools, ...skills.flatMap((entry) => entry.tools)]);
  const uncovered = tools.filter((name) => !coveredTools.has(name));
  if (uncovered.length > 0) {
    throw new Error(`${domain} registry tools lack skill/base coverage: ${uncovered.join(",")}`);
  }

  if (converted) await checkConvertedDomain(domain, root, skills, baseTools, toolSpecs);

  return { name: domain, toolCount: tools.length, skillCount: skills.length, converted };
}

type RegistrySkill = z.output<typeof registrySkillSchema>;
type ToolSpecs =
  z.output<typeof toolSpecSchema> extends infer Spec ? Readonly<Record<string, Spec>> : never;

/** The invariants that only exist once prose and policy live in separate files. */
async function checkConvertedDomain(
  domain: string,
  root: string,
  skills: readonly RegistrySkill[],
  baseTools: readonly string[],
  toolSpecs: ToolSpecs,
): Promise<void> {
  // Static skill markdown is advertised to every principal that can reach the
  // subagent, so an `admin` skill can no longer hide its own contents. The gate
  // that still holds is per-tool, and this is what makes it hold: an admin
  // skill whose tools are merely organizer-default would be a silent widening.
  for (const entry of skills.filter((candidate) => candidate.minRole === UserRole.Admin)) {
    const weak = entry.tools.filter((name) => toolSpecs[name]?.access.minRole !== UserRole.Admin);
    if (weak.length > 0) {
      throw new Error(
        `${domain}/${entry.name} is admin-gated but these tools do not declare ` +
          `minRole "admin": ${weak.join(",")}`,
      );
    }
  }

  // Prose and policy are separate files; neither may reference a skill the
  // other does not have.
  const declared = skills.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const documented = await skillDocNames(root);
  const missingDoc = declared.filter((name) => !documented.includes(name));
  const orphanDoc = documented.filter((name) => !declared.includes(name));
  if (missingDoc.length > 0 || orphanDoc.length > 0) {
    throw new Error(
      `${domain} skills and skills/*.md disagree` +
        (missingDoc.length > 0 ? `; no prose for: ${missingDoc.join(",")}` : "") +
        (orphanDoc.length > 0 ? `; no registry entry for: ${orphanDoc.join(",")}` : ""),
    );
  }

  const docs: SkillDoc[] = [];
  for (const entry of skills) {
    const { description } = await readSkillDoc(root, entry.name);
    docs.push({ name: entry.name, minRole: entry.minRole, tools: entry.tools, description });
  }

  // The README's tool table is derived, so it cannot be allowed to rot.
  const readmePath = join(root, "README.md");
  if (!(await fileExists(readmePath))) {
    throw new Error(`${readmePath} is required; run \`bun run readmes\` to create it`);
  }
  const current = await readFile(readmePath, "utf8");
  const expected = renderSubagentReadme({
    domain,
    skills: docs,
    baseTools: [...baseTools],
    tools: toolSpecs,
    existing: current,
  });
  if (normalizeReadme(expected) !== normalizeReadme(current)) {
    throw new Error(`${domain}/README.md is stale; run \`bun run readmes\``);
  }
}

const subagents = await subagentNames();
const domains = await integrationDomains(subagents);
const surfaces = await Promise.all(domains.map(checkDomain));
const auxiliary = subagents.filter((name) => !domains.includes(name));
const pending = surfaces.filter((surface) => !surface.converted).map((surface) => surface.name);

for (const surface of surfaces) {
  console.info(`${surface.name}: ${surface.toolCount} tools / ${surface.skillCount} skills`);
}
console.info(
  `capabilities: ${domains.length} native domains, ` +
    `${surfaces.reduce((total, surface) => total + surface.toolCount, 0)} tools, ` +
    `${surfaces.reduce((total, surface) => total + surface.skillCount, 0)} skills, ` +
    `${subagents.length} subagents (${auxiliary.join(", ")} auxiliary)`,
);
if (pending.length > 0) {
  console.info(`awaiting the registry shape: ${pending.join(", ")}`);
}
