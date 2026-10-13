import { z } from "zod";

export class BadgeApiError extends Error {
  readonly url: string | undefined;
  constructor(message: string, url?: string) {
    super(message);
    this.url = url;
  }
}
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
      if (!response.ok) {
        const problem = z
          .object({ error: z.string(), url: z.url().optional() })
          .safeParse(result).data;
        throw new BadgeApiError(
          problem?.error ?? `Badge service failed (${response.status}).`,
          problem?.url,
        );
      }
      return result;
    },
  };
}
