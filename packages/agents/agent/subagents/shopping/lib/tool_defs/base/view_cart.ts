import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { getCart } from "../../cart-store.ts";
import { summarize, toPublic } from "../../projections.ts";

const PAGE_SIZE = 10;

export const view_cart = defineTool({
  description:
    "View the shared cart. Items are paginated to keep Discord messages short — pass `page` (1-indexed) to navigate when there are many items.",
  access: { risk: "read" },
  requires: "TURSO_DATABASE_URL",
  input: z.strictObject({
    page: z
      .int()
      .min(1)
      .default(1)
      .describe(`Page number (1-indexed). Page size is ${PAGE_SIZE} items.`),
  }),
  execute: async ({ page }) => {
    const snapshot = await getCart();
    const totalPages = Math.max(1, Math.ceil(snapshot.items.length / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const start = (current - 1) * PAGE_SIZE;
    return {
      page: current,
      total_pages: totalPages,
      page_size: PAGE_SIZE,
      items: snapshot.items.slice(start, start + PAGE_SIZE).map(toPublic),
      ...summarize(snapshot.items),
      updated_at: snapshot.updatedAt,
    };
  },
});
