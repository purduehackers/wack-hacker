import type { DomainSurface } from "./capability-surface.ts";

interface NamedCapability {
  readonly id: string;
  readonly name: string;
}

function collisions(entries: readonly NamedCapability[]) {
  const byName = new Map<string, string[]>();
  for (const entry of entries) {
    const ids = byName.get(entry.name) ?? [];
    ids.push(entry.id);
    byName.set(entry.name, ids);
  }
  return [...byName]
    .filter(([, ids]) => ids.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, ids]) => ({ name, ids: ids.toSorted() }));
}

export function capabilityReport(surfaces: readonly DomainSurface[]) {
  const tools = surfaces.flatMap((domain) => domain.tools);
  const skills = surfaces.flatMap((domain) => domain.skills);
  return {
    version: 1,
    scope: "Authored provider capabilities; excludes root, framework, and runtime-selected tools.",
    readiness: {
      implementation:
        "Registry imports, callable executors, source layout, and skill coverage checked.",
      configuration: "unverified",
      providerPermissions: "unverified",
      integrationValidation: "unverified",
      note: "No provider calls or credential-value inspection. An empty requires list is not proof of readiness.",
    },
    roleSemantics: {
      entryRole: "Domain runtime subagent admission descriptor.",
      toolRole: "Tool runtime descriptor, including its role default.",
      admittedRole:
        "Maximum of domain admission and tool/skill role; excludes budget and contextual policy.",
      skillPaths:
        "Per-tool skill routes also include the skill role. Skill loading does not authorize execution.",
      confirmation: "runtime-default means policy decides; it does not mean no confirmation.",
    },
    summary: {
      domains: surfaces.length,
      tools: tools.length,
      skills: skills.length,
      uniqueBareToolNames: new Set(tools.map((entry) => entry.name)).size,
      uniqueBareSkillNames: new Set(skills.map((entry) => entry.name)).size,
    },
    collisions: { tools: collisions(tools), skills: collisions(skills) },
    domains: surfaces,
  };
}

export function summarizeCapabilityReport(report: ReturnType<typeof capabilityReport>): string {
  const lines = [
    "Wack provider capability inventory",
    `${report.summary.domains} domains / ${report.summary.tools} tools / ${report.summary.skills} skills`,
    "Authored implementation checked; configuration, provider permissions, and end-to-end behavior unverified.",
    "",
    "Domain\tTools\tSkills\tEntry role",
    ...report.domains.map(
      (domain) =>
        `${domain.name}\t${domain.tools.length}\t${domain.skills.length}\t${domain.entryRole}`,
    ),
    "",
    "Bare-name collisions (use these namespaced identities):",
  ];
  for (const kind of ["tools", "skills"] as const) {
    lines.push(`${kind}: ${report.collisions[kind].length} ambiguous names`);
    for (const entry of report.collisions[kind])
      lines.push(`  ${entry.name}: ${entry.ids.join(", ")}`);
  }
  lines.push(
    "",
    "Use --json for sources, access metadata, skill mappings, and declared requirements.",
  );
  return lines.join("\n");
}
