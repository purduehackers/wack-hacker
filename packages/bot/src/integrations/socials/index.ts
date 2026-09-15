import {
  InvalidInput,
  RateLimited,
  RecoveryRequired,
  Transient,
  UpstreamError,
} from "@repo/shared/errors";
import type { KnownError } from "@repo/shared/errors";

import { createBlogSource, createYouTubeSource } from "./sources/feed.ts";
import { createInstagramSource } from "./sources/instagram.ts";
import type { InstagramClientOptions } from "./sources/instagram.ts";
import type { SocialSource } from "./types.ts";

export function createSocialSources(instagram: InstagramClientOptions): readonly SocialSource[] {
  return [createYouTubeSource(), createBlogSource(), createInstagramSource(instagram)];
}

/** Transport and schema exceptions may contain provider response bodies or tokens. */
export function socialError(cause: unknown): KnownError {
  if (
    InvalidInput.is(cause) ||
    RateLimited.is(cause) ||
    RecoveryRequired.is(cause) ||
    Transient.is(cause) ||
    UpstreamError.is(cause)
  )
    return cause;
  return new Transient({
    operation: "socials",
    detail:
      "storage, parsing, or Discord request failed; check service health and channel permissions",
  });
}
