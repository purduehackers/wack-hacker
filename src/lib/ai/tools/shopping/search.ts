import { tool } from "ai";
import { z } from "zod";

import { searchAmazon } from "./client.ts";

const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 10;

export const search_products = tool({
  description:
    "Search Amazon for products matching a query. Returns a list of products with ASIN, title, price (USD), rating, image URL, and product URL. Use the ASIN when adding to the cart.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("What to search Amazon for (e.g., 'mechanical keyboard', 'usb-c hub')"),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(HARD_MAX_RESULTS)
      .default(DEFAULT_MAX_RESULTS)
      .describe(`Max products to return (1-${HARD_MAX_RESULTS})`),
  }),
  execute: async ({ query, max_results }) => {
    const products = await searchAmazon(query, max_results);
    return JSON.stringify({ query, count: products.length, products });
  },
});
