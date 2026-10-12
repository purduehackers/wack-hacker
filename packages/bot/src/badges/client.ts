import { z } from "zod";

export interface BadgeClient {
  post<T>(path: string, body: T, timeout?: number): Promise<unknown>;
}
export function createBadgeClient(baseUrl: string, secret: string): BadgeClient {
  return {
    async post(path, body, timeout = 20_000) {
      const response = await fetch(new URL(`/badges/${path}`, baseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      const result: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          z.object({ error: z.string() }).safeParse(result).data?.error ??
            `Badge service failed (${response.status}).`,
        );
      return result;
    },
  };
}
