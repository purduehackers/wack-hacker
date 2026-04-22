import { vi, type Mock } from "vitest";

import type { FetchImpl } from "../types";

/**
 * Swap `globalThis.fetch` for the duration of a test. Returns both the mock fn
 * (for assertions) and a `restore()` helper — call `restore()` in `afterEach`
 * so later tests don't see a poisoned fetch.
 *
 * The `impl` receives a `URL` regardless of whether the caller passed a
 * string, URL, or Request — normalization happens here.
 */
export function mockFetch(impl: FetchImpl): {
  fetch: Mock;
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      input instanceof URL
        ? input
        : typeof input === "string"
          ? new URL(input)
          : new URL(input.url);
    return impl(url);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetch: fetchMock,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}
