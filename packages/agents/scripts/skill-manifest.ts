/// <reference types="node" />

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export const frontmatterSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  criteria: z.string().min(1),
  routing: z.string().optional(),
  tools: z.array(z.string()).optional(),
  baseTools: z.array(z.string()).optional(),
  minRole: z.enum(["public", "organizer", "admin"]),
  mode: z.enum(["inline", "delegate"]),
});
export type Frontmatter = z.infer<typeof frontmatterSchema>;

export const compiledSkillSchema = frontmatterSchema.extend({
  toolNames: z.array(z.string()),
  instructions: z.string(),
});
export type CompiledSkill = z.infer<typeof compiledSkillSchema>;

export interface DomainSkillManifest {
  readonly domain: string;
  readonly sourceName: string;
  readonly baseToolNames: readonly string[];
  readonly skills: readonly CompiledSkill[];
  readonly toolNames: readonly string[];
}

const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(here, "..");
export const agentRoot = join(packageRoot, "agent");
export const sourcesRoot = join(packageRoot, "skill-sources");

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
}

function parseList(value: string): string[] {
  const body = value.trim().replace(/^\[/u, "").replace(/\]$/u, "");
  return body
    .split(",")
    .map(unquote)
    .filter((entry) => entry !== "");
}

/** The skill headers intentionally use only scalars and bracketed string lists. */
function parseFrontmatter(source: string): unknown {
  const record: Record<string, unknown> = {};
  const sourceLines = source.split("\n");
  for (let index = 0; index < sourceLines.length; index += 1) {
    const currentLine = sourceLines[index] ?? "";
    const colon = currentLine.indexOf(":");
    if (colon < 1) continue;
    const key = currentLine.slice(0, colon).trim();
    let value = currentLine.slice(colon + 1).trim();
    if (
      (key === "tools" || key === "baseTools") &&
      value === "" &&
      index + 1 < sourceLines.length
    ) {
      index += 1;
      value = sourceLines[index]?.trim() ?? "";
    }
    if (value.startsWith("[") && !value.endsWith("]")) {
      while (index + 1 < sourceLines.length && !value.endsWith("]")) {
        index += 1;
        value += ` ${sourceLines[index]?.trim() ?? ""}`;
      }
    }
    record[key] = value.startsWith("[") ? parseList(value) : unquote(value);
  }
  return record;
}

export function parseSkill(
  markdown: string,
  path: string,
): { meta: Frontmatter; instructions: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(markdown);
  if (match === null) throw new Error(`${path}: missing YAML frontmatter`);
  const parsed = frontmatterSchema.safeParse(parseFrontmatter(match[1] ?? ""));
  if (!parsed.success)
    throw new Error(`${path}: invalid skill frontmatter: ${parsed.error.message}`);
  return { meta: parsed.data, instructions: (match[2] ?? "").trim() };
}

function duplicates(inputNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const toolName of inputNames) {
    if (seen.has(toolName)) repeated.add(toolName);
    seen.add(toolName);
  }
  return [...repeated].sort((left, right) => left.localeCompare(right));
}

async function declaredToolNames(domainRoot: string): Promise<string[]> {
  const implementationNames: string[] = [];
  let registryNames: string[] = [];
  for (const entry of await readdir(join(domainRoot, "lib"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name === "skills.generated.ts") {
      continue;
    }
    const source = await readFile(join(domainRoot, "lib", entry.name), "utf8");
    for (const match of source.matchAll(/export const (\w+)\s*=\s*defineTool/gu)) {
      if (match[1] !== undefined) implementationNames.push(match[1]);
    }
    if (entry.name === "tool-registry.ts") {
      registryNames = [...source.matchAll(/^  (\w+):/gmu)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      );
      for (const match of source.matchAll(/^  (\w+): defineTool\(/gmu)) {
        if (match[1] !== undefined) implementationNames.push(match[1]);
      }
    }
  }

  const duplicateImplementations = duplicates(implementationNames);
  const duplicateRegistryEntries = duplicates(registryNames);
  const implementationSet = new Set(implementationNames);
  const registrySet = new Set(registryNames);
  const missingFromRegistry = [...implementationSet].filter((name) => !registrySet.has(name));
  const missingImplementation = [...registrySet].filter((name) => !implementationSet.has(name));
  if (
    registryNames.length === 0 ||
    duplicateImplementations.length > 0 ||
    duplicateRegistryEntries.length > 0 ||
    missingFromRegistry.length > 0 ||
    missingImplementation.length > 0
  ) {
    throw new Error(
      `${domainRoot} tool registry mismatch: ` +
        `duplicate implementations=[${duplicateImplementations.join(",")}], ` +
        `duplicate registry entries=[${duplicateRegistryEntries.join(",")}], ` +
        `missing from registry=[${missingFromRegistry.join(",")}], ` +
        `missing implementation=[${missingImplementation.join(",")}]`,
    );
  }
  return [...registrySet].sort((left, right) => left.localeCompare(right));
}

export async function listSkillDomains(): Promise<string[]> {
  return (await readdir(sourcesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function buildDomainSkillManifest(domain: string): Promise<DomainSkillManifest> {
  const sources = join(sourcesRoot, domain);
  const domainRoot = join(agentRoot, "subagents", domain);
  const rootPath = join(sources, "SKILL.md");
  const root = parseSkill(await readFile(rootPath, "utf8"), rootPath);
  const sourceEntries = await readdir(sources, { withFileTypes: true });
  const skillsRoot = sourceEntries.some((entry) => entry.isDirectory() && entry.name === "skills")
    ? join(sources, "skills")
    : sources;
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const compiledSkills: CompiledSkill[] = [];
  for (const entry of entries
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(skillsRoot, entry.name, "SKILL.md");
    const parsedSkill = parseSkill(await readFile(path, "utf8"), path);
    if (parsedSkill.meta.name !== entry.name) throw new Error(`${path}: name must match directory`);
    compiledSkills.push({
      ...parsedSkill.meta,
      toolNames: parsedSkill.meta.tools ?? [],
      instructions: parsedSkill.instructions,
    });
  }

  const toolNames = await declaredToolNames(domainRoot);
  const registered = new Set([
    ...(root.meta.baseTools ?? []),
    ...compiledSkills.flatMap((registeredSkill) => registeredSkill.toolNames),
  ]);
  const toolSet = new Set(toolNames);
  const missing = toolNames.filter((name) => !registered.has(name));
  const unknown = [...registered].filter((name) => !toolSet.has(name));
  if (toolNames.length === 0 || missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `${domain} skill registry mismatch: ${toolNames.length} tools, ${compiledSkills.length} skills, ` +
        `missing=[${missing.join(",")}], unknown=[${unknown.join(",")}]`,
    );
  }

  return {
    domain,
    sourceName: root.meta.name,
    baseToolNames: root.meta.baseTools ?? [],
    skills: compiledSkills,
    toolNames,
  };
}

function pascalCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function renderGeneratedSkills(manifest: DomainSkillManifest): string {
  const constant = manifest.domain.toUpperCase().replaceAll("-", "_");
  const typeName = `${pascalCase(manifest.domain)}SkillName`;
  return (
    `// Generated by scripts/compile-skills.ts. Do not edit.
` +
    `export const ${constant}_BASE_TOOL_NAMES = ${JSON.stringify(manifest.baseToolNames, undefined, 2)} as const;

` +
    `export const ${constant}_SKILLS = ${JSON.stringify(manifest.skills, undefined, 2)} as const;

` +
    `export type ${typeName} = (typeof ${constant}_SKILLS)[number]["name"];
`
  );
}
