import { tool } from "ai";
import { z } from "zod";

import { searchAmazon } from "./client.ts";

const MAX_RESULTS_DEFAULT = 5;
const MAX_RESULTS_UPPER = 10;
const MAX_RESULTS_LOWER = 1;

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
      .min(MAX_RESULTS_LOWER)
      .max(MAX_RESULTS_UPPER)
      .optional()
      .describe(`Max products to return (1-${MAX_RESULTS_UPPER}, default ${MAX_RESULTS_DEFAULT})`),
  }),
  execute: async ({ query, max_results }) => {
    const limit = max_results ?? MAX_RESULTS_DEFAULT;
    const products = await searchAmazon(query, limit);
    return JSON.stringify({ query, count: products.length, products });
  },
});
