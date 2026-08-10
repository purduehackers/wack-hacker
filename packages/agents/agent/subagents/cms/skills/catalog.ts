import { defineDynamic } from "eve/skills";

import { resolveIntegrationSkills } from "../../../lib/policy/skill-catalog.ts";
import { CMS_SKILLS } from "../lib/registry.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => resolveIntegrationSkills(ctx.session.auth.current, CMS_SKILLS),
  },
});
