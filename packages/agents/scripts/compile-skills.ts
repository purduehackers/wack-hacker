/// <reference types="node" />

import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  agentRoot,
  buildDomainSkillManifest,
  listSkillDomains,
  renderGeneratedSkills,
} from "./skill-manifest.ts";

for (const domain of await listSkillDomains()) {
  const manifest = await buildDomainSkillManifest(domain);
  const output = join(agentRoot, "subagents", domain, "lib/skills.generated.ts");
  await writeFile(output, renderGeneratedSkills(manifest));
  console.info(
    `generated ${relative(process.cwd(), output)} ` +
      `(${manifest.toolNames.length} tools / ${manifest.skills.length} skills)`,
  );
}
