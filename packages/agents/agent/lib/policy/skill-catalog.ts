import type { UserRole } from "@repo/shared/discord";
import { roleAtLeast } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { SessionAuthContext } from "eve/context";
import { defineSkill } from "eve/skills";

import { requirePrincipal } from "./principal.ts";

/**
 * One integration skill: its policy, its tool membership, and its prose.
 *
 * `doc` is the whole `lib/skill_defs/<name>.md` file, imported as text. Keeping
 * the markdown in a real document rather than an escaped string literal is the
 * point — a 1,700-character one-liner cannot be reviewed, and every one of
 * these used to be one.
 */
export interface IntegrationSkillDefinition {
  readonly name: string;
  readonly minRole: UserRole;
  readonly tools: readonly string[];
  readonly doc: string;
}

/**
 * The pre-markdown shape, still used by domains awaiting conversion.
 *
 * Removed once the last `skills/catalog.ts` stops declaring prose inline.
 */
export interface LegacySkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly criteria: string;
  readonly minRole: UserRole;
  readonly tools: readonly string[];
  readonly instructions: string;
}

/**
 * Splits leading frontmatter off a skill document.
 *
 * Only `description` is read, because that is all `defineSkill` takes besides
 * the body. Anything else is ignored rather than rejected, so a document can
 * carry editor metadata without this needing to know about it.
 */
export function parseSkillDoc(doc: string): { description: string; markdown: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(doc);
  const frontmatter = match?.[1];
  if (match === null || frontmatter === undefined) {
    return { description: "", markdown: doc.trim() };
  }
  const description = /^description:[ \t]*(.+)$/mu.exec(frontmatter)?.[1]?.trim() ?? "";
  return { description, markdown: doc.slice(match[0].length).trim() };
}

/** The document a legacy definition would have been, had it been a file. */
function legacyMarkdown(skill: LegacySkillDefinition): string {
  const tools = skill.tools.map((name) => `\`${name}\``).join(", ");
  return `## When to use\n\n${skill.criteria}\n\n## Relevant tools\n\n${tools}\n\n## Instructions\n\n${skill.instructions}`;
}

/**
 * Converts the current principal's catalog into Eve-native loadable skills.
 *
 * The role filter is why this stays a dynamic resolver. Eve binds *static*
 * skills at graph-resolution time, before any session exists, so a static skill
 * is advertised to everyone who can reach the subagent. Filtering here is the
 * only place `minRole` can mean anything.
 */
export function resolveIntegrationSkills(
  current: SessionAuthContext | null | undefined,
  definitions: readonly (IntegrationSkillDefinition | LegacySkillDefinition)[],
) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return {};

  return Object.fromEntries(
    definitions
      .filter((skill) => roleAtLeast(principal.value.role, skill.minRole))
      .map((skill) => {
        const { description, markdown } =
          "doc" in skill
            ? parseSkillDoc(skill.doc)
            : { description: skill.description, markdown: legacyMarkdown(skill) };
        return [
          skill.name,
          defineSkill({ description, markdown, metadata: { minRole: skill.minRole } }),
        ];
      }),
  );
}
