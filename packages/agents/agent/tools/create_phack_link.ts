import { UpstreamError } from "@repo/shared/errors";
import { PHACK_RESERVED_SLUGS, PHACK_SLUG_PATTERN, writePhackLink } from "@repo/shared/phack";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "../env.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/policy/core-tools.ts";
import { guardToolExecution } from "../lib/serialization.ts";

const PROPAGATION_NOTE = "The redirect may take a few seconds to start working everywhere.";
const RANDOM_SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const RANDOM_SLUG_LENGTH = 8;
const RANDOM_SLUG_ATTEMPTS = 5;
const UNBIASED_BYTE_LIMIT = 252;

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(PHACK_SLUG_PATTERN, {
    error: "Use letters, numbers, and interior hyphens only.",
  })
  .refine((slug) => !PHACK_RESERVED_SLUGS.has(slug.toLowerCase()), {
    error: "This path is reserved by the shortener.",
  });

const destinationSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .pipe(z.url({ protocol: /^https$/u }))
  .refine((destination) => {
    const url = URL.parse(destination);
    return url?.username === "" && url.password === "";
  }, "Destination URLs cannot contain credentials.")
  .transform((destination) => new URL(destination).href);

export const createPhackLinkInputSchema = z.strictObject({
  slug: slugSchema
    .optional()
    .describe(
      "Optional bare, case-sensitive path after phack.rs/. Omit for a random 8-character slug.",
    ),
  destination: destinationSchema.describe("The absolute HTTPS URL this link should open"),
});

/** Stable across Eve replay, while HMAC makes each call's slug unpredictable. */
async function randomSlug(token: string, callKey: string, attempt: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  let slug = "";
  let block = 0;
  while (slug.length < RANDOM_SLUG_LENGTH) {
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(`${callKey}:${attempt}:${block}`)),
    );
    block += 1;
    for (const byte of digest) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      slug += RANDOM_SLUG_ALPHABET[byte % RANDOM_SLUG_ALPHABET.length];
      if (slug.length === RANDOM_SLUG_LENGTH) return slug;
    }
  }
  return slug;
}

/** Map the shared create result into the tool's user-facing envelope. */
async function createLinkOnce(
  slug: string,
  destination: string,
  token: string,
  signal: AbortSignal,
) {
  const result = await writePhackLink({ slug, destination, token, signal });
  const url = `https://phack.rs/${slug}`;
  if (result.kind === "created" || result.kind === "same") {
    return { ok: true, created: result.kind === "created", url, note: PROPAGATION_NOTE } as const;
  }
  if (result.kind === "exists") {
    return {
      ok: false,
      code: "slug_taken",
      message: `The slug ${slug} already points to a different destination.`,
    } as const;
  }
  if (result.kind === "error") {
    throw new UpstreamError({
      service: "Vercel Global Config",
      status: result.status,
      detail: "link creation failed",
    });
  }
  const messages = {
    invalid_request: "Vercel rejected this link. Check the slug and destination.",
    conflict: `Vercel reported a conflict for ${slug}. Check the link before trying another slug.`,
    unverified: `Could not verify whether ${url} was created. Check the link before retrying.`,
  };
  return { ok: false, code: result.kind, message: messages[result.kind] } as const;
}

/** Generated candidates are stable for this tool call and retried only after a confirmed collision. */
export async function createPhackLink(
  input: z.output<typeof createPhackLinkInputSchema>,
  callKey: string,
  signal = AbortSignal.timeout(10_000),
) {
  const token = env.VERCEL_API_TOKEN;
  if (token === undefined) {
    throw new UpstreamError({
      service: "Vercel Global Config",
      status: 503,
      detail: "integration is not configured",
    });
  }

  if (input.slug !== undefined) {
    return createLinkOnce(input.slug, input.destination, token, signal);
  }

  for (let attempt = 0; attempt < RANDOM_SLUG_ATTEMPTS; attempt += 1) {
    const slug = await randomSlug(token, callKey, attempt);
    const result = await createLinkOnce(slug, input.destination, token, signal);
    if (result.ok || result.code !== "slug_taken") return result;
  }

  return {
    ok: false,
    code: "slug_unavailable",
    message: "Could not find an unused random slug. Try again.",
  } as const;
}

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("create_phack_link", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Create a phack.rs short link for an organizer. Use only when an organizer asks to create one. Provide an HTTPS destination; the optional slug defaults to a random 8-character path. Existing slugs are never overwritten.",
        inputSchema: createPhackLinkInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("create_phack_link", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              const signal = AbortSignal.any([toolCtx.abortSignal, AbortSignal.timeout(10_000)]);
              return await createPhackLink(
                input,
                `${toolCtx.session.id}:${toolCtx.callId}`,
                signal,
              );
            } catch (cause) {
              return coreToolFailure("Vercel Global Config", cause);
            }
          });
        },
      });
    },
  },
});
