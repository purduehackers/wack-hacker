import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { env } from "../../../env.ts";
import type { ProductResult } from "./shopping-types.ts";

const SERPAPI_URL = "https://serpapi.com/search.json";

/**
 * Value a {@link ProductResult} field carries when SerpAPI omitted it. Every
 * product in a search result keeps the same key set so the model can compare
 * rows, which means the gap has to serialize as an explicit null rather than a
 * missing key. One named sentinel keeps the rest of this module under the
 * no-null rule.
 */
// oxlint-disable-next-line unicorn/no-null -- serialized product rows keep a stable key set, so a missing field is an explicit null
const ABSENT = null;

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
type SerpApiOrganicResult = z.output<typeof serpApiOrganicResultSchema>;

function parsePrice(result: SerpApiOrganicResult): number | null {
  if (result.extracted_price !== undefined) return result.extracted_price;
  if (!result.price) return ABSENT;
  const match = result.price.match(/[\d,]+\.?\d*/);
  if (!match) return ABSENT;
  const num = Number.parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(num) ? num : ABSENT;
}

function normalize(result: SerpApiOrganicResult): ProductResult | undefined {
  if (!result.asin || !result.title) return undefined;
  return {
    asin: result.asin,
    title: result.title,
    price: parsePrice(result),
    rating: result.rating ?? ABSENT,
    image: result.thumbnail ?? ABSENT,
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
  const decoded = serpApiResponseSchema.safeParse(await response.json());
  if (!decoded.success) {
    throw new UpstreamError({
      service: "SerpAPI",
      status: 502,
      detail: `invalid response: ${z.prettifyError(decoded.error)}`,
    });
  }
  const data = decoded.data;
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
