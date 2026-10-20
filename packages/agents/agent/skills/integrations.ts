import { defineDynamic, defineSkill } from "eve/skills";

import { env } from "../env.ts";
import { INTEGRATION_DOMAINS } from "../lib/catalog/domains.ts";
import { qualifySkillReferences } from "../lib/catalog/skill-references.ts";
import { resolveIntegrationSkills } from "../lib/policy/skill-catalog.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!env.MAIN_AGENT_CATALOG_ENABLED) return {};
      return Object.fromEntries(
        Object.values(INTEGRATION_DOMAINS)
          .filter((domain) => domain.discoverable(ctx.session.auth.current))
          .flatMap((domain) => {
            const skills = resolveIntegrationSkills(ctx.session.auth.current, domain.skills);
            const qualify = (markdown: string) =>
              qualifySkillReferences(
                markdown,
                domain.name,
                Object.keys(domain.tools),
                Object.keys(skills),
              );
            const instructions = [
              `# ${domain.name} integration`,
              `Use eve__search to discover ${domain.name}__ tools and eve__tool to call them.`,
              `Tool names in this procedure are qualified with ${domain.name}__ at the root.`,
              "Use eve__skill to load namespaced skills. Remain Wack Hacker; the following specialist guidance describes this provider's procedures.",
              qualify(domain.instructions),
            ].join("\n\n");
            return [
              [
                `${domain.name}__overview`,
                defineSkill({
                  deferred: true,
                  description: `Start ${domain.name} work: provider rules, basic reads, and available specialized procedures.`,
                  markdown: `${instructions}\n\nAvailable skills: ${Object.keys(skills)
                    .map((name) => `${domain.name}__${name}`)
                    .join(", ")}.`,
                }),
              ],
              ...Object.entries(skills).map(([name, skill]) => [
                `${domain.name}__${name}`,
                defineSkill({
                  ...skill,
                  deferred: true,
                  markdown: `${instructions}\n\n${qualify(skill.markdown)}`,
                }),
              ]),
            ];
          }),
      );
    },
  },
});
