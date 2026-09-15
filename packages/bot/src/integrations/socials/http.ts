import { InvalidInput, RateLimited, Transient, UpstreamError } from "@repo/shared/errors";

import type { SocialFetch } from "./types.ts";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Provider bodies/transport exceptions can contain credentials. Never log them. */
export async function socialRequest(
  service: string,
  url: URL,
  request: SocialFetch = fetch,
  headers: NonNullable<RequestInit["headers"]> = {},
): Promise<string> {
  let response: Response;
  try {
    response = await request(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new Transient({ operation: `${service} request`, detail: "network failure or timeout" });
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    throw new RateLimited({
      service,
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 60_000,
    });
  }
  if (response.status >= 500) {
    throw new Transient({ operation: `${service} request`, detail: `HTTP ${response.status}` });
  }
  if (!response.ok) {
    throw new UpstreamError({
      service,
      status: response.status,
      detail:
        response.status === 401 || response.status === 403
          ? "check account credentials and read permissions"
          : "request rejected",
    });
  }
  const reader = response.body?.getReader();
  if (reader === undefined)
    throw new InvalidInput({ subject: service, issues: ["empty response"] });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new InvalidInput({ subject: service, issues: ["response exceeds 4 MiB"] });
      }
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
