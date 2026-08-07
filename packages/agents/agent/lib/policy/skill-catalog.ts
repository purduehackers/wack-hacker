import type { UserRole } from "@repo/shared/discord";
import { roleAtLeast } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { SessionAuthContext } from "eve/context";
import { defineSkill } from "eve/skills";

import { requirePrincipal } from "./principal.ts";

/** Project-owned policy and content for one integration skill. */
export interface IntegrationSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly criteria: string;
  readonly minRole: UserRole;
  readonly tools: readonly string[];
  readonly instructions: string;
}

function nativeMarkdown(skill: IntegrationSkillDefinition): string {
  const tools = skill.tools.map((name) => `\`${name}\``).join(", ");
  return `## When to use\n\n${skill.criteria}\n\n## Relevant tools\n\n${tools}\n\n## Instructions\n\n${skill.instructions}`;
}

/** Converts the current principal's catalog into Eve-native loadable skills. */
export function resolveIntegrationSkills(
  current: SessionAuthContext | null | undefined,
  definitions: readonly IntegrationSkillDefinition[],
) {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return {};

  return Object.fromEntries(
    definitions
      .filter((skill) => roleAtLeast(principal.value.role, skill.minRole))
      .map((skill) => [
        skill.name,
        defineSkill({
          description: skill.description,
          markdown: nativeMarkdown(skill),
          metadata: { criteria: skill.criteria, minRole: skill.minRole },
        }),
      ]),
  );
}
