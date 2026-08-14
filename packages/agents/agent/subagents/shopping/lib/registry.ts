/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice. Splitting them is what lets a tool exist that
 * no skill describes. `tool_defs/` mirrors the skill list exactly, and
 * `check:capabilities` fails if it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and arrives as a text
 * import. The markdown stays a real document while policy sits here next to
 * the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import cartDoc from "./skill_defs/cart.md" with { type: "text" };
import { search_products } from "./tool_defs/base/search_products.ts";
import { view_cart } from "./tool_defs/base/view_cart.ts";
import { add_to_cart } from "./tool_defs/cart/add_to_cart.ts";
import { clear_cart } from "./tool_defs/cart/clear_cart.ts";
import { remove_from_cart } from "./tool_defs/cart/remove_from_cart.ts";
import { update_quantity } from "./tool_defs/cart/update_quantity.ts";

export const SHOPPING_TOOLS = {
  add_to_cart,
  clear_cart,
  remove_from_cart,
  search_products,
  update_quantity,
  view_cart,
} as const satisfies Record<string, DomainToolSpec>;

export type ShoppingToolName = keyof typeof SHOPPING_TOOLS;

export const SHOPPING_BASE_TOOL_NAMES = ["search_products", "view_cart"] as const;

export const SHOPPING_SKILLS = [
  {
    name: "cart",
    minRole: "organizer",
    doc: cartDoc,
    tools: ["add_to_cart", "remove_from_cart", "update_quantity", "clear_cart"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];
