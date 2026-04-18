import { log } from "evlog";

import type { ModelInfo } from "./types.ts";

export type { ModelInfo } from "./types.ts";

const CATALOG_URL = "https://models.dev/api.json";

interface RawModelEntry {
  id: string;
  name?: string;
  release_date?: string;
  last_updated?: string;
  cost?: { input: number; output: number };
  limit?: { context: number; output: number };
}

interface RawProviderEntry {
  id?: string;
  name?: string;
  models?: Record<string, RawModelEntry>;
}

type RawCatalog = Record<string, RawProviderEntry>;

/**
 * Split "anthropic/claude-sonnet-4.6" into provider + model key. Returns null
 * if the identifier doesn't follow `provider/model-name`.
 */
function parseGatewayModel(gatewayModelId: string): { provider: string; key: string } | null {
  const slash = gatewayModelId.indexOf("/");
  if (slash <= 0 || slash === gatewayModelId.length - 1) return null;
  return {
    provider: gatewayModelId.slice(0, slash),
    key: gatewayModelId.slice(slash + 1),
  };
}

/** Normalize dots → dashes so "claude-sonnet-4.6" matches models.dev "claude-sonnet-4-6". */
function normalize(key: string): string {
  return key.replaceAll(".", "-");
}

function pickLatest(candidates: RawModelEntry[]): RawModelEntry | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const left = a.last_updated ?? a.release_date ?? "";
    const right = b.last_updated ?? b.release_date ?? "";
    return right.localeCompare(left);
  })[0];
}

/**
 * Locate the models.dev entry that best matches a gateway model identifier.
 * Exported for unit testing; prefer `fetchModelInfo` in production paths.
 */
export function matchModel(catalog: RawCatalog, gatewayModelId: string): ModelInfo | null {
  const parsed = parseGatewayModel(gatewayModelId);
  if (!parsed) return null;
  const provider = catalog[parsed.provider];
  if (!provider?.models) return null;

  const normalizedKey = normalize(parsed.key);
  const entries = Object.values(provider.models);

  // Exact id match first, then prefix match (catches dated variants like
  // claude-sonnet-4-5 → claude-sonnet-4-5-20250929).
  const exact = entries.filter((m) => m.id === normalizedKey);
  const prefix =
    exact.length > 0
      ? exact
      : entries.filter((m) => m.id.startsWith(`${normalizedKey}-`) || m.id === normalizedKey);

  const picked = pickLatest(prefix);
  if (!picked?.limit || !picked.cost) return null;

  return {
    id: picked.id,
    provider: parsed.provider,
    limit: picked.limit,
    cost: picked.cost,
  };
}

const CATALOG_FETCH_TIMEOUT_MS = 15_000;

export async function fetchCatalog(fetchImpl: typeof fetch = fetch): Promise<RawCatalog | null> {
  try {
    const res = await fetchImpl(CATALOG_URL, {
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      log.warn("models-dev", `fetch ${CATALOG_URL} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as RawCatalog;
  } catch (err) {
    log.warn("models-dev", `fetch failed: ${String(err)}`);
    return null;
  }
}

/**
 * Look up context window + pricing for a gateway model identifier. Returns
 * null if the catalog can't be fetched or no matching entry exists.
 */
export async function fetchModelInfo(
  gatewayModelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelInfo | null> {
  const catalog = await fetchCatalog(fetchImpl);
  if (!catalog) return null;
  return matchModel(catalog, gatewayModelId);
}
