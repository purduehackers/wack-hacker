import * as m_cart from "./cart.ts";
import type { ShoppingToolSpec } from "./define-tool.ts";
import * as m_search from "./search.ts";

export const SHOPPING_TOOLS = {
  add_to_cart: m_cart.add_to_cart,
  clear_cart: m_cart.clear_cart,
  remove_from_cart: m_cart.remove_from_cart,
  search_products: m_search.search_products,
  update_quantity: m_cart.update_quantity,
  view_cart: m_cart.view_cart,
} as const satisfies Record<string, ShoppingToolSpec>;

export type ShoppingToolName = keyof typeof SHOPPING_TOOLS;
