import { z } from "zod";

export const socialPlatformSchema = z.enum(["blog", "youtube", "instagram"]);
export type SocialPlatform = z.output<typeof socialPlatformSchema>;

export const socialPostSchema = z.object({
  id: z.string().min(1),
  url: z.url({ protocol: /^https$/u }),
  title: z.string(),
  text: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
  imageUrl: z.url({ protocol: /^https$/u }).optional(),
});
export type SocialPost = z.output<typeof socialPostSchema>;

/** Adapters own discovery; baseline, deduplication, retries, and Discord are shared. */
export interface SocialSource {
  readonly id: SocialPlatform;
  readonly account: string;
  readonly name: string;
  readonly profileUrl: string;
  /** Feeds can drop old entries; paginated APIs can reach the requested boundary. */
  readonly history: "window" | "paginated";
  /** Return all available posts since this time, including the boundary. */
  readonly read: (since: Date) => Promise<readonly SocialPost[]>;
}

export type SocialFetch = (url: URL, init: RequestInit) => Promise<Response>;
