import type { ProductResult } from "../../../shopping/types.ts";

import { env } from "../../../../env.ts";

const SERPAPI_URL = "https://serpapi.com/search.json";

interface SerpApiOrganicResult {
  asin?: string;
  title?: string;
  link?: string;
  link_clean?: string;
  price?: string;
  extracted_price?: number;
  rating?: number;
  thumbnail?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  error?: string;
}

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
    api_key: env.SERPAPI_API_KEY,
  });
  const response = await fetch(`${SERPAPI_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`SerpAPI returned ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as SerpApiResponse;
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
