import { UpstreamError } from "@repo/shared/errors";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "../env.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/policy/core-tools.ts";
import { guardToolExecution } from "../lib/serialization.ts";

const GLOBAL_CONFIG_ID = "ecfg_k1ocmrcfwo57k9v2klgtljycqsqj";
const TEAM_ID = "team_kOQWJUQYzGW4blWthdK71Y8A";
const ITEMS_URL = `https://api.vercel.com/v1/global-config/${GLOBAL_CONFIG_ID}/items?teamId=${TEAM_ID}`;
const RESERVED_SLUGS = new Set(["404", "api", "dashboard", "favicon", "login"]);
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
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])$/u, {
    error: "Use letters, numbers, and interior hyphens only.",
  })
  .refine((slug) => !RESERVED_SLUGS.has(slug.toLowerCase()), {
    error: "This path is reserved by the shortener.",
  });

const destinationSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .pipe(z.url({ protocol: /^https$/u }))
  .refine((destination) => {
    try {
      const url = new URL(destination);
      return url.username === "" && url.password === "";
    } catch {
      return false;
    }
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

const itemSchema = z.looseObject({ value: z.looseObject({ d: z.string() }) });
type LinkInput = { readonly slug: string; readonly destination: string };

function linkUrl(slug: string): string {
  return `https://phack.rs/${slug}`;
}

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

/** Read-only reconciliation for a conflict or a write whose outcome is uncertain. */
async function reconcileLink(
  input: LinkInput,
  token: string,
  failure: "invalid_request" | "conflict" | "unverified",
) {
  try {
    const response = await fetch(
      `https://api.vercel.com/v1/global-config/${GLOBAL_CONFIG_ID}/item/${input.slug}?teamId=${TEAM_ID}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (response.ok) {
      const item = itemSchema.safeParse(await response.json());
      if (item.success && item.data.value.d === input.destination) {
        // An interrupted Eve step may run again after Vercel accepted its write.
        return {
          ok: true,
          created: false,
          url: linkUrl(input.slug),
          note: PROPAGATION_NOTE,
        } as const;
      }
      if (item.success) {
        return {
          ok: false,
          code: "slug_taken",
          message: `The slug ${input.slug} already points to a different destination.`,
        } as const;
      }
    }
  } catch {
    // A read can fail while the create still commits; only another read may resolve it.
  }
  if (failure === "invalid_request") {
    return {
      ok: false,
      code: failure,
      message: "Vercel rejected this link. Check the slug and destination.",
    } as const;
  }
  if (failure === "conflict") {
    return {
      ok: false,
      code: failure,
      message: `Vercel reported a conflict for ${input.slug}. Check the link before trying another slug.`,
    } as const;
  }
  return {
    ok: false,
    code: failure,
    message: `Could not verify whether ${linkUrl(input.slug)} was created. Check the link before retrying.`,
  } as const;
}

/** A create-only write never replaces an existing redirect or resets its visit count. */
async function createLinkOnce(input: LinkInput, token: string, signal?: AbortSignal) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  let response: Response;
  try {
    response = await fetch(ITEMS_URL, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        items: [{ operation: "create", key: input.slug, value: { d: input.destination, v: 0 } }],
      }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return reconcileLink(input, token, "unverified");
  }

  if (response.ok) {
    return {
      ok: true,
      created: true,
      url: linkUrl(input.slug),
      note: PROPAGATION_NOTE,
    } as const;
  }

  if (response.status === 400) return reconcileLink(input, token, "invalid_request");
  if (response.status === 409) return reconcileLink(input, token, "conflict");
  if (response.status === 408 || response.status >= 500) {
    return reconcileLink(input, token, "unverified");
  }

  throw new UpstreamError({
    service: "Vercel Global Config",
    status: response.status,
    detail: "link creation failed",
  });
}

/** Generated candidates are stable for this tool call and retried only after a confirmed collision. */
export async function createPhackLink(
  input: z.output<typeof createPhackLinkInputSchema>,
  callKey: string,
  signal?: AbortSignal,
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
    return createLinkOnce({ slug: input.slug, destination: input.destination }, token, signal);
  }

  for (let attempt = 0; attempt < RANDOM_SLUG_ATTEMPTS; attempt += 1) {
    const slug = await randomSlug(token, callKey, attempt);
    const result = await createLinkOnce({ slug, destination: input.destination }, token, signal);
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
