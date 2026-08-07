/* oxlint-disable unicorn/no-null -- Product projections use null to represent external fields with no value. */
import { z } from "zod";

import { env } from "../../../lib/env.ts";
import type { ProductResult } from "./shopping-types.ts";

const SERPAPI_URL = "https://serpapi.com/search.json";

const serpApiOrganicResultSchema = z.object({
  asin: z.string().optional(),
  title: z.string().optional(),
  link: z.string().optional(),
  link_clean: z.string().optional(),
  price: z.string().optional(),
  extracted_price: z.number().optional(),
  rating: z.number().optional(),
  thumbnail: z.string().optional(),
});
const serpApiResponseSchema = z.object({
  organic_results: z.array(serpApiOrganicResultSchema).optional(),
  error: z.string().optional(),
});
type SerpApiOrganicResult = z.infer<typeof serpApiOrganicResultSchema>;

function parsePrice(result: SerpApiOrganicResult): number | null {
  if (typeof result.extracted_price === "number") return result.extracted_price;
  if (!result.price) return null;
  const match = result.price.match(/[\d,]+\.?\d*/);
  if (!match) return null;
  const num = Number.parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function normalize(result: SerpApiOrganicResult): ProductResult | null {
  if (!result.asin || !result.title) return null;
  return {
    asin: result.asin,
    title: result.title,
    price: parsePrice(result),
    rating: result.rating ?? null,
    image: result.thumbnail ?? null,
    url: result.link_clean ?? result.link ?? `https://www.amazon.com/dp/${result.asin}`,
  };
}

export async function searchAmazon(query: string, maxResults: number): Promise<ProductResult[]> {
  const params = new URLSearchParams({
    engine: "amazon",
    amazon_domain: "amazon.com",
    k: query,
    api_key: env.SERPAPI_API_KEY ?? "",
  });
  const response = await fetch(`${SERPAPI_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`SerpAPI returned ${response.status}: ${await response.text()}`);
  }
  const data = serpApiResponseSchema.parse(await response.json());
  if (data.error) throw new Error(data.error);
  const organic = data.organic_results ?? [];
  const normalized: ProductResult[] = [];
  for (const item of organic) {
    const product = normalize(item);
    if (product) normalized.push(product);
    if (normalized.length >= maxResults) break;
  }
  return normalized;
}
