import { InvalidInput, RecoveryRequired } from "@repo/shared/errors";
import { jsonCodec } from "@repo/shared/json";
import { suppressTracing } from "@sentry/bun";
import { z } from "zod";

import { socialRequest } from "../http.ts";
import { socialPostSchema } from "../types.ts";
import type { SocialFetch, SocialPost, SocialSource } from "../types.ts";

const identitySchema = z.object({ user_id: z.string(), username: z.string() });
const mediaSchema = z
  .object({
    id: z.string(),
    caption: z.string().optional(),
    permalink: z.url({ protocol: /^https$/u, hostname: /^www\.instagram\.com$/u }),
    timestamp: z
      .string()
      .transform((value) => value.replace(/([+-]\d{2})(\d{2})$/u, "$1:$2"))
      .pipe(z.iso.datetime({ offset: true })),
    media_type: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
    media_url: z.url().optional(),
    thumbnail_url: z.url().optional(),
  })
  .transform((media): SocialPost => ({
    id: media.id,
    url: media.permalink,
    title: media.media_type === "VIDEO" ? "New Instagram video" : "New Instagram post",
    text: media.caption ?? "",
    publishedAt: media.timestamp,
    imageUrl: media.media_type === "VIDEO" ? media.thumbnail_url : media.media_url,
  }))
  .pipe(socialPostSchema);
const pageSchema = z.object({
  data: z.array(mediaSchema),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
      next: z.string().optional(),
    })
    .optional(),
});
const refreshSchema = z.object({ access_token: z.string().min(1), expires_in: z.int().positive() });

function decode<S extends z.ZodType>(schema: S, raw: string): z.output<S> {
  const parsed = jsonCodec(schema).safeParse(raw);
  if (!parsed.success)
    throw new InvalidInput({
      subject: "Instagram response",
      issues: ["unexpected response shape"],
    });
  return parsed.data;
}

export interface InstagramClientOptions {
  readonly accountId: string;
  readonly token: () => Promise<string>;
  readonly request?: SocialFetch | undefined;
}

export function createInstagramClient(options: InstagramClientOptions) {
  const read = async (path: string, params: URLSearchParams) => {
    const url = new URL(path, "https://graph.instagram.com");
    url.search = params.toString();
    const token = await options.token();
    return socialRequest("instagram", url, options.request, { Authorization: `Bearer ${token}` });
  };
  return {
    identity: async () => {
      const raw = await read("/v26.0/me", new URLSearchParams({ fields: "user_id,username" }));
      const identity = decode(identitySchema, raw);
      if (identity.user_id !== options.accountId || identity.username !== "purduehackers") {
        throw new InvalidInput({
          subject: "Instagram identity",
          issues: ["expected @purduehackers and configured account ID"],
        });
      }
    },
    page: async (after?: string) => {
      const params = new URLSearchParams({
        fields: "id,caption,permalink,timestamp,media_type,media_url,thumbnail_url",
        limit: "100",
      });
      if (after !== undefined) params.set("after", after);
      const raw = await read(`/v26.0/${options.accountId}/media`, params);
      return decode(pageSchema, raw);
    },
    refresh: async () => {
      // Unlike media reads, this endpoint requires the token in the query.
      // instrument.ts also excludes it from outgoing HTTP breadcrumbs.
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.search = new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: await options.token(),
      }).toString();
      const raw = await suppressTracing(() =>
        socialRequest("Instagram refresh", url, options.request),
      );
      const refreshed = decode(refreshSchema, raw);
      return { token: refreshed.access_token, expiresIn: refreshed.expires_in };
    },
  };
}

export function createInstagramSource(options: InstagramClientOptions): SocialSource {
  const api = createInstagramClient(options);
  return {
    id: "instagram",
    account: options.accountId,
    name: "Instagram",
    profileUrl: "https://www.instagram.com/purduehackers/",
    history: "paginated",
    read: async (since) => {
      await api.identity();
      const posts: SocialPost[] = [];
      const cursors = new Set<string>();
      let after: string | undefined;
      for (let index = 0; index < 20; index++) {
        const page = await api.page(after);
        posts.push(...page.data);
        // Media is ordered newest first. Include the complete boundary page.
        if (
          !page.paging?.next ||
          page.data.some((entry) => Date.parse(entry.publishedAt) < since.getTime())
        )
          return posts;
        after = page.paging.cursors?.after;
        if (after === undefined || cursors.has(after)) break;
        cursors.add(after);
      }
      throw new RecoveryRequired({
        operation: "Instagram pagination",
        detail: "could not reach previous polling window",
        remediation: "check the account and cursor before advancing its checkpoint",
      });
    },
  };
}
