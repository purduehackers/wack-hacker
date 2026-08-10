import { defineDynamic } from "eve/skills";

import { resolveIntegrationSkills } from "../../../lib/policy/skill-catalog.ts";
import { GITHUB_SKILLS } from "../lib/registry.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, GITHUB_SKILLS),
  },
});
