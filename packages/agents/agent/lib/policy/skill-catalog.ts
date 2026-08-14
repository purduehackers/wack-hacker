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
 * point. Nobody can review a 1,700-character one-liner, and every one of these
 * used to be one.
 */
export interface IntegrationSkillDefinition {
  readonly name: string;
  readonly minRole: UserRole;
  readonly tools: readonly string[];
  readonly doc: string;
}

/**
 * Splits leading frontmatter off a skill document.
 *
 * This function reads only `description`, because that is all `defineSkill`
 * takes besides the body. It ignores anything else rather than rejecting it,
 * so a document can carry editor metadata without this needing to know about
 * it.
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

/**
 * Converts the current principal's catalog into Eve-native loadable skills.
 *
 * The role filter is why this stays a dynamic resolver. Eve binds *static*
 * skills at graph-resolution time, before any session exists, so Eve
 * advertises a static skill to everyone who can reach the subagent. Filtering
 * here is the only place `minRole` can mean anything.
 */
export function resolveIntegrationSkills(
  current: SessionAuthContext | null | undefined,
  definitions: readonly IntegrationSkillDefinition[],
) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return {};

  return Object.fromEntries(
    definitions
      .filter((skill) => roleAtLeast(principal.value.role, skill.minRole))
      .map((skill) => {
        const { description, markdown } = parseSkillDoc(skill.doc);
        return [
          skill.name,
          defineSkill({ description, markdown, metadata: { minRole: skill.minRole } }),
        ];
      }),
  );
}
