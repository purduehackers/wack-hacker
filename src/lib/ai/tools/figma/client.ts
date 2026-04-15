import { env } from "../../../../env.ts";

const BASE_URL = "https://api.figma.com/v1";

export async function figmaFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = new Headers(options?.headers);
  headers.set("X-Figma-Token", env.FIGMA_ACCESS_TOKEN);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(url, {
    ...options,
    headers,
    signal: options?.signal ?? AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Figma API ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export function figmaFileUrl(fileKey: string, nodeId?: string): string {
  const base = `https://www.figma.com/file/${fileKey}`;
  return nodeId ? `${base}?node-id=${encodeURIComponent(nodeId)}` : base;
}
