/// <reference types="node" />

/**
 * Renders `subagents/<domain>/README.md` from that domain's registry.
 *
 * The tool table is the part that rots: 689 rows nobody will hand-maintain past
 * the first rename. Generating it and having `check:capabilities` re-render in
 * memory and compare means the table is either correct or CI is red — the same
 * job that script already does for skill/tool coverage.
 *
 * Prose above the marker is hand-written and preserved.
 */

import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UserRole } from "@repo/shared/discord";
import { z } from "zod";

import { parseSkillDoc } from "../agent/lib/policy/skill-catalog.ts";
import { normalizeReadme, renderSubagentReadme, type SkillDoc } from "./lib/subagent-readme.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const subagentsRoot = join(packageRoot, "agent/subagents");

const skillSchema = z.strictObject({
  name: z.string(),
  minRole: z.enum(UserRole),
  tools: z.array(z.string()),
  doc: z.string(),
});
const toolSpecSchema = z.looseObject({
  description: z.string(),
  access: z.looseObject({ risk: z.string(), minRole: z.enum(UserRole).optional() }),
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const domains = (await readdir(subagentsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

let rendered = 0;
for (const domain of domains) {
  const root = join(subagentsRoot, domain);
  if (!(await exists(join(root, "lib/registry.ts")))) continue;

  const constant = domain.toUpperCase().replaceAll("-", "_");
  const registry = z
    .record(z.string(), z.unknown())
    .parse(await import(pathToFileURL(join(root, "lib/registry.ts")).href));
  const skills = z.array(skillSchema).parse(registry[`${constant}_SKILLS`]);
  const baseTools = z.array(z.string()).parse(registry[`${constant}_BASE_TOOL_NAMES`]);
  const tools = z.record(z.string(), toolSpecSchema).parse(registry[`${constant}_TOOLS`]);

  const docs: SkillDoc[] = skills.map((skill) => {
    const { description } = parseSkillDoc(skill.doc);
    if (description === "") {
      throw new Error(`${domain}/${skill.name}.md needs a \`description\` in its frontmatter`);
    }
    return { name: skill.name, minRole: skill.minRole, tools: skill.tools, description };
  });

  const readmePath = join(root, "README.md");
  const existing = (await exists(readmePath)) ? await readFile(readmePath, "utf8") : undefined;
  const next = renderSubagentReadme({
    domain,
    skills: docs,
    baseTools,
    tools,
    ...(existing === undefined ? {} : { existing }),
  });
  if (existing === undefined || normalizeReadme(next) !== normalizeReadme(existing)) {
    await writeFile(readmePath, next);
    rendered += 1;
  }
}

console.info(`readmes: ${rendered} written, ${domains.length} subagents scanned`);
