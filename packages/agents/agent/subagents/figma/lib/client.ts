import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../env.ts";

const BASE_URL = "https://api.figma.com";

class FigmaClient {
  get teamId(): string {
    return env.FIGMA_TEAM_ID ?? "";
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    headers["X-Figma-Token"] = env.FIGMA_ACCESS_TOKEN ?? "";
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
      await res.body?.cancel();
      throw new UpstreamError({
        service: "Figma",
        status: res.status,
        detail: `${method} request failed`,
      });
    }

    // The Figma package publishes generated response types but no runtime client or schemas,
    // and TypeScript types `Response.json()` as `Promise<unknown>` here, so narrowing to `T`
    // needs either this assertion or a runtime validator that would change what the client
    // accepts. Keep the assertion at this one transport boundary. Every caller supplies the
    // generated response export for its concrete endpoint.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- this transport boundary narrows to generated Figma response types
    return res.json() as Promise<T>;
  }
}

export const figma = new FigmaClient();

/** Builds the web URL for a file key, so tool replies can link straight into Figma. */
export function figmaFileUrl(fileKey: string): string {
  return `https://www.figma.com/file/${fileKey}`;
}
