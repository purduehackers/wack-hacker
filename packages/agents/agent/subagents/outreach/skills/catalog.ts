import { defineDynamic } from "eve/skills";

import { resolveIntegrationSkills } from "../../../lib/policy/skill-catalog.ts";
import { OUTREACH_SKILLS } from "../lib/registry.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, OUTREACH_SKILLS),
  },
});
