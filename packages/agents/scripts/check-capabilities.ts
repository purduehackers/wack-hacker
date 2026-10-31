/// <reference types="node" />

import { checkMigrationParity, readMigrationBaseline } from "./lib/capability-baseline.ts";
import { readCapabilitySurface } from "./lib/capability-surface.ts";

const surface = await readCapabilitySurface();
const baseline = await readMigrationBaseline();
checkMigrationParity(surface.domains, baseline);

for (const domain of surface.domains) {
  console.info(`${domain.name}: ${domain.tools.length} tools / ${domain.skills.length} skills`);
}
console.info(
  `capabilities: ${surface.domains.length} native domains, ` +
    `${surface.domains.reduce((total, domain) => total + domain.tools.length, 0)} tools, ` +
    `${surface.domains.reduce((total, domain) => total + domain.skills.length, 0)} skills, ` +
    `${surface.subagentCount} subagents (${surface.auxiliary.join(", ")} auxiliary)`,
);
console.info(`migration parity: preserved the surface recorded at ${baseline.sourceCommit}`);
const pending = surface.domains.filter((domain) => !domain.converted).map((domain) => domain.name);
if (pending.length > 0) console.info(`awaiting the registry shape: ${pending.join(", ")}`);
