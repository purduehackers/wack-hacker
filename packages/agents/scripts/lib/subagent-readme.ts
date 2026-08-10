/// <reference types="node" />

import type { UserRole } from "@repo/shared/discord";

/** One skill's policy plus the description lifted from its markdown frontmatter. */
export interface SkillDoc {
  readonly name: string;
  readonly minRole: UserRole;
  readonly tools: readonly string[];
  readonly description: string;
}

interface ToolSpec {
  readonly description: string;
  readonly access: { readonly risk: string; readonly minRole?: UserRole | undefined };
}

export interface ReadmeInput {
  readonly domain: string;
  readonly skills: readonly SkillDoc[];
  readonly baseTools: readonly string[];
  readonly tools: Readonly<Record<string, ToolSpec>>;
  /** The current file, so hand-written prose above the marker survives. */
  readonly existing?: string;
}

/**
 * Everything below this line is derived from `lib/registry.ts` and the skill
 * markdown. Prose above it is hand-written and preserved across regeneration.
 */
export const GENERATED_MARKER = "<!-- generated: do not edit below this line -->";

/**
 * A tool's effective minimum role.
 *
 * Mirrors `descriptorOf` in `lib/policy/domain-runtime.ts`: a tool that does not
 * declare one gets `public` when it only reads and `organizer` otherwise.
 * Recomputing it here rather than importing keeps this script free of the
 * runtime's module graph, at the cost of one rule that must stay in step — if
 * that default ever changes, this table starts lying.
 */
function effectiveRole(spec: ToolSpec): string {
  if (spec.access.minRole !== undefined) return spec.access.minRole;
  return spec.access.risk === "read" ? "public" : "organizer";
}

/** Collapses a tool description to something that fits a table cell. */
function summarize(description: string): string {
  const firstSentence = /^(.*?[.!?])(?:\s|$)/u.exec(description.trim())?.[1] ?? description.trim();
  const cell = firstSentence.replaceAll("|", "\\|").replaceAll("\n", " ");
  return cell.length > 120 ? `${cell.slice(0, 117)}…` : cell;
}

function toolTable(
  toolNames: readonly string[],
  tools: Readonly<Record<string, ToolSpec>>,
): readonly string[] {
  const rows = [...toolNames]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((entry) => {
      const spec = tools[entry];
      if (spec === undefined) return [];
      return [
        `| \`${entry}\` | ${spec.access.risk} | ${effectiveRole(spec)} | ${summarize(spec.description)} |`,
      ];
    });
  return ["| Tool | Risk | Role | What it does |", "| --- | --- | --- | --- |", ...rows];
}

/**
 * Collapses a README to the form both the generator and oxfmt agree on.
 *
 * oxfmt column-aligns markdown tables, so the file on disk never matches what
 * `renderSubagentReadme` emitted even when the content is identical. Comparing
 * normalized forms lets the staleness check catch a real change — a renamed
 * tool, a changed risk level — without firing on padding.
 */
export function normalizeReadme(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|")) return line;
      const columns = line
        .split("|")
        .map((text) => text.trim().replace(/\s+/gu, " "))
        .map((text) => (/^:?-{2,}:?$/u.test(text) ? text.replaceAll(/-{2,}/gu, "---") : text));
      return columns.join("|");
    })
    .join("\n")
    .trimEnd();
}

export function renderSubagentReadme(input: ReadmeInput): string {
  const { domain, skills, baseTools, tools, existing } = input;
  const toolCount = Object.keys(tools).length;

  const head =
    existing !== undefined && existing.includes(GENERATED_MARKER)
      ? existing.slice(0, existing.indexOf(GENERATED_MARKER))
      : `# \`${domain}\`\n\n_Write the identity of this subagent here._\n\n`;

  const lines: string[] = [GENERATED_MARKER, ""];

  lines.push(
    `## Surface`,
    "",
    `**${toolCount} tools** across **${skills.length} skills**` +
      (baseTools.length > 0 ? `, plus ${baseTools.length} always-available` : "") +
      ".",
    "",
  );

  lines.push("## Skills", "");
  lines.push("| Skill | Role | Tools | Description |", "| --- | --- | ---: | --- |");
  for (const skill of skills) {
    lines.push(
      `| [\`${skill.name}\`](skills/${skill.name}.md) | ${skill.minRole} | ` +
        `${skill.tools.length} | ${summarize(skill.description)} |`,
    );
  }
  lines.push("");

  if (baseTools.length > 0) {
    lines.push(
      "## Always available",
      "",
      "Reachable without loading a skill.",
      "",
      ...toolTable(baseTools, tools),
      "",
    );
  }

  for (const skill of skills) {
    lines.push(
      `## \`${skill.name}\``,
      "",
      skill.description,
      "",
      ...toolTable(skill.tools, tools),
      "",
    );
  }

  return `${head}${lines.join("\n").trimEnd()}\n`;
}
