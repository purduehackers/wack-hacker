import { z } from "zod";

import { assertUnique, capabilityId, type DomainSurface } from "./capability-surface.ts";

const baselineSchema = z.strictObject({
  version: z.literal(1),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  domains: z
    .array(
      z.strictObject({
        name: z.string(),
        baseTools: z.array(z.string()),
        skills: z.array(z.strictObject({ id: z.string(), tools: z.array(z.string()) })),
      }),
    )
    .min(1),
});
export type MigrationBaseline = z.output<typeof baselineSchema>;

function validateIds(domain: string, ids: readonly string[], label: string): void {
  assertUnique(label, ids);
  const prefix = `${domain}__`;
  for (const id of ids) {
    if (!id.startsWith(prefix) || capabilityId(domain, id.slice(prefix.length)) !== id) {
      throw new Error(`${label}: ${id} is not an identity in ${domain}`);
    }
  }
}

/** A frozen migration contract, not a generated copy of current policy/schema. */
export function parseMigrationBaseline(value: unknown): MigrationBaseline {
  const baseline = baselineSchema.parse(value);
  assertUnique(
    "baseline domains",
    baseline.domains.map((domain) => domain.name),
  );
  for (const domain of baseline.domains) {
    capabilityId(domain.name, "identity");
    validateIds(domain.name, domain.baseTools, `${domain.name} baseline base tools`);
    validateIds(
      domain.name,
      domain.skills.map((skill) => skill.id),
      `${domain.name} baseline skills`,
    );
    for (const skill of domain.skills) {
      validateIds(domain.name, skill.tools, `${skill.id} baseline tools`);
    }
  }
  return baseline;
}

export async function readMigrationBaseline(): Promise<MigrationBaseline> {
  return parseMigrationBaseline(
    await Bun.file(new URL("../../capabilities/migration-baseline.json", import.meta.url)).json(),
  );
}

interface ParityDomain {
  readonly name: string;
  readonly baseTools: readonly string[];
  readonly tools: readonly Pick<DomainSurface["tools"][number], "id">[];
  readonly skills: readonly Pick<DomainSurface["skills"][number], "id" | "tools">[];
}

function missing(expected: readonly string[], actual: readonly string[]): string[] {
  const present = new Set(actual);
  return expected.filter((id) => !present.has(id));
}

/** Additions are welcome; dropping a tool, skill, or existing access path is not. */
export function checkMigrationParity(
  current: readonly ParityDomain[],
  baseline: MigrationBaseline,
): void {
  const problems: string[] = [];
  for (const expected of baseline.domains) {
    const actual = current.find((domain) => domain.name === expected.name);
    if (actual === undefined) {
      problems.push(`missing domain ${expected.name}`);
      continue;
    }
    const toolIds = actual.tools.map((tool) => tool.id);
    const expectedTools = [
      ...new Set([...expected.baseTools, ...expected.skills.flatMap((skill) => skill.tools)]),
    ];
    for (const id of missing(expectedTools, toolIds)) problems.push(`missing tool ${id}`);
    for (const id of missing(expected.baseTools, actual.baseTools)) {
      problems.push(`base discovery no longer includes ${id}`);
    }
    for (const expectedSkill of expected.skills) {
      const skill = actual.skills.find((entry) => entry.id === expectedSkill.id);
      if (skill === undefined) problems.push(`missing skill ${expectedSkill.id}`);
      else {
        for (const id of missing(expectedSkill.tools, skill.tools)) {
          problems.push(`${expectedSkill.id} no longer reaches ${id}`);
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Capability migration lost baseline coverage:\n  ${problems.join("\n  ")}`);
  }
}
