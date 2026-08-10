import { defineDynamic } from "eve/skills";

import { resolveIntegrationSkills } from "../../../lib/policy/skill-catalog.ts";
import { LINEAR_SKILLS } from "../lib/registry.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, LINEAR_SKILLS),
  },
});
