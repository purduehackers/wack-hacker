import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const SHOPPING_BASE_TOOL_NAMES = ["search_products", "view_cart"] as const;

export const SHOPPING_SKILL_DEFINITIONS = [
  {
    name: "cart",
    description: "Add, remove, update quantities, and clear the shared cart.",
    criteria:
      "Use when the user wants to add an item, remove an item, change a quantity, or clear the cart.",
    minRole: "organizer",
    tools: ["add_to_cart", "remove_from_cart", "update_quantity", "clear_cart"],
    instructions:
      "<adding>\n- Use the ASIN, title, and price returned by `search_products`. Never invent an ASIN.\n- If `price` was `null` in the search result, ask the user for a price or skip the item.\n- Adding the same ASIN again merges quantities — this is expected.\n</adding>\n\n<removing>\n- `remove_from_cart` takes an ASIN. If the user names an item by title, look it up with `view_cart` first.\n</removing>\n\n<updating>\n- `update_quantity` with `quantity: 0` removes the item.\n- Quantities are integers only.\n</updating>\n\n<clearing>\n- `clear_cart` wipes every item for everyone. Always confirm before calling.\n</clearing>",
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, SHOPPING_SKILL_DEFINITIONS),
  },
});
