import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import cartDoc from "../lib/skill_defs/cart.md" with { type: "text" };

export const SHOPPING_BASE_TOOL_NAMES = ["search_products", "view_cart"] as const;

export const SHOPPING_SKILL_DEFINITIONS = [
  {
    name: "cart",
    minRole: "organizer",
    doc: cartDoc,
    tools: ["add_to_cart", "remove_from_cart", "update_quantity", "clear_cart"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, SHOPPING_SKILL_DEFINITIONS),
  },
});
