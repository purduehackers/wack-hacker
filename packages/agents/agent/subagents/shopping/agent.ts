import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Search Amazon and manage a shared virtual shopping cart. A wishlist only — there is no real " +
    "checkout. Use when: the user wants to search Amazon products, add or remove items from the " +
    "team cart, or view the shared cart.",
  model: "anthropic/claude-sonnet-5",
});
