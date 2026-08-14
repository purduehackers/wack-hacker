/// <reference types="node" />

/**
 * @fileoverview Cross-file invariants for the agent's capability surface.
 *
 * Every check here is a relationship *between* files, which is exactly what a
 * code review cannot see. Each hunk reads as correct on its own and the defect
 * only exists in the pairing. A skill listing a tool the registry no longer
 * defines, or a registry tool no skill can reach, is a silent runtime failure.
 * The tool either fails to resolve or is undiscoverable by any role.
 *
 * Deriving the surface also imports every registry, so a top-level throw in any
 * of them fails here rather than at boot.
 *
 * This deliberately does NOT snapshot the surface. A `minRole` change is one
 * line in a registry and shows up in the diff on its own. Pinning a generated
 * copy of it only adds a second file to update. It also invites regenerating
 * past the very change the pin was meant to surface.
 */

import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UserRole } from "@repo/shared/discord";
import { z } from "zod";

import { parseSkillDoc } from "../agent/lib/policy/skill-catalog.ts";
import { normalizeReadme, renderSubagentReadme, type SkillDoc } from "./lib/subagent-readme.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const agentRoot = join(packageRoot, "agent");

/**
 * A skill as declared today: policy here, prose in `lib/skill_defs/<name>.md`.
 *
 * Converted domains export these as `<DOMAIN>_SKILLS` from `lib/registry.ts`
 * alongside the tools. The rest still export `<DOMAIN>_SKILL_DEFINITIONS` from
 * `skills/catalog.ts` until their tools are split. The shape is the same either
 * way — only the module differs.
 */
const registrySkillSchema = z.strictObject({
  name: z.string().trim().min(1),
  minRole: z.enum(UserRole),
  tools: z.array(z.string()),
  doc: z.string().trim().min(1),
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

/** The registry must claim every `.md` in `lib/skill_defs/`, and vice versa. */
async function skillDocNames(root: string): Promise<string[]> {
  const dir = join(root, "lib/skill_defs");
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

  const skills = z
    .array(registrySkillSchema)
    .parse(skillModule[converted ? `${constant}_SKILLS` : `${constant}_SKILL_DEFINITIONS`]);

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

  // Prose lives in files for every domain now, so these run everywhere. The
  // README check is the only part that waits for `lib/registry.ts`.
  await checkSkillDocs(domain, root, skills);
  await checkToolLayout(domain, root, skills, baseTools, tools);
  if (converted) await checkReadme(domain, root, skills, baseTools, toolSpecs);

  return { name: domain, toolCount: tools.length, skillCount: skills.length, converted };
}

type RegistrySkill = z.output<typeof registrySkillSchema>;
type ToolSpecs =
  z.output<typeof toolSpecSchema> extends infer Spec ? Readonly<Record<string, Spec>> : never;

/** The invariants that only exist once prose and policy live in separate files. */
/**
 * `lib/tool_defs/` must mirror the skill list: one directory per skill plus
 * `base`, one file per tool, each file in the bundle whose skill lists it.
 *
 * Nothing else enforces this. The registry compiles whatever it imports. An
 * orphan file, a tool filed under the wrong skill, or a directory named after a
 * skill that no longer exists all ship silently. That is the exact drift the
 * split set out to remove.
 */
async function checkToolLayout(
  domain: string,
  root: string,
  skills: readonly RegistrySkill[],
  baseTools: readonly string[],
  toolNames: readonly string[],
): Promise<void> {
  const defsRoot = join(root, "lib/tool_defs");
  if (!(await fileExists(defsRoot))) return;

  const expectedBundles = new Set(skills.map((entry) => entry.name));
  if (baseTools.length > 0) expectedBundles.add("base");

  // More than one skill may list a tool, so it may legitimately live in
  // any bundle that claims it.
  const claimedBy = new Map<string, Set<string>>();
  const claim = (tool: string, bundle: string) =>
    claimedBy.set(tool, (claimedBy.get(tool) ?? new Set()).add(bundle));
  for (const entry of skills) for (const name of entry.tools) claim(name, entry.name);
  for (const name of baseTools) claim(name, "base");

  const problems: string[] = [];
  const seen = new Set<string>();
  for (const bundle of await readdir(defsRoot, { withFileTypes: true })) {
    if (!bundle.isDirectory()) {
      problems.push(`lib/tool_defs/${bundle.name} is not a bundle directory`);
      continue;
    }
    if (!expectedBundles.has(bundle.name)) {
      problems.push(`lib/tool_defs/${bundle.name}/ matches no skill`);
      continue;
    }
    for (const file of await readdir(join(defsRoot, bundle.name))) {
      if (!file.endsWith(".ts")) continue;
      const tool = file.slice(0, -3);
      seen.add(tool);
      const owners = claimedBy.get(tool);
      if (owners === undefined) problems.push(`${tool} is not in the registry`);
      else if (!owners.has(bundle.name)) {
        problems.push(
          `${tool} sits in ${bundle.name}/ but only ${[...owners].join(", ")} claims it`,
        );
      }
    }
  }
  const unfiled = toolNames.filter((name) => !seen.has(name));
  if (unfiled.length > 0) problems.push(`no tool_defs file for: ${unfiled.join(",")}`);

  if (problems.length > 0) {
    throw new Error(`${domain} tool_defs layout:\n  ${problems.join("\n  ")}`);
  }
}

/** Prose and policy are separate files. Neither may name a skill the other lacks. */
async function checkSkillDocs(
  domain: string,
  root: string,
  skills: readonly RegistrySkill[],
): Promise<void> {
  const declared = skills.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const documented = await skillDocNames(root);
  const missingDoc = declared.filter((name) => !documented.includes(name));
  const orphanDoc = documented.filter((name) => !declared.includes(name));
  if (missingDoc.length > 0 || orphanDoc.length > 0) {
    throw new Error(
      `${domain} skills and lib/skill_defs/*.md disagree` +
        (missingDoc.length > 0 ? `; no prose for: ${missingDoc.join(",")}` : "") +
        (orphanDoc.length > 0 ? `; no registry entry for: ${orphanDoc.join(",")}` : ""),
    );
  }
  for (const entry of skills) {
    if (parseSkillDoc(entry.doc).description === "") {
      throw new Error(`${domain}/${entry.name}.md needs a \`description\` in its frontmatter`);
    }
  }
}

/** The README's tool table derives from the registry, so this check refuses to let it rot. */
async function checkReadme(
  domain: string,
  root: string,
  skills: readonly RegistrySkill[],
  baseTools: readonly string[],
  toolSpecs: ToolSpecs,
): Promise<void> {
  const docs: SkillDoc[] = skills.map((entry) => ({
    name: entry.name,
    minRole: entry.minRole,
    tools: entry.tools,
    description: parseSkillDoc(entry.doc).description,
  }));

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
