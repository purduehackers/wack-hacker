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
  slug: slugSchema.describe("The bare, case-sensitive path after phack.rs/"),
  destination: destinationSchema.describe("The absolute HTTPS URL this link should open"),
});

const itemSchema = z.looseObject({ value: z.looseObject({ d: z.string() }) });

function linkUrl(slug: string): string {
  return `https://phack.rs/${slug}`;
}

/** Read-only reconciliation for a conflict or a write whose outcome is uncertain. */
async function reconcileLink(
  input: z.output<typeof createPhackLinkInputSchema>,
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
export async function createPhackLink(
  input: z.output<typeof createPhackLinkInputSchema>,
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

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("create_phack_link", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Create a phack.rs short link for an organizer. Use only when an organizer asks to create one. Provide a new bare slug and an HTTPS destination; existing slugs are never overwritten.",
        inputSchema: createPhackLinkInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("create_phack_link", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              const signal = AbortSignal.any([toolCtx.abortSignal, AbortSignal.timeout(10_000)]);
              return await createPhackLink(input, signal);
            } catch (cause) {
              return coreToolFailure("Vercel Global Config", cause);
            }
          });
        },
      });
    },
  },
});
