import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { hunter, notion } from "./client.ts";

/**
 * Value these tools report for a Hunter field the API left out of its response.
 * The model has to see "Hunter was asked and returned nothing" rather than a
 * missing key, so the JSON output carries an explicit null. One named sentinel
 * keeps the rest of this module under the no-null rule.
 */
// oxlint-disable-next-line unicorn/no-null -- serialized tool output distinguishes an unresolved field from an absent key
const ABSENT = null;

const emailFinderResponseSchema = z.object({
  data: z
    .object({
      email: z.string().nullable().optional(),
      score: z.number().optional(),
      sources: z.array(z.object({ domain: z.string(), uri: z.string() })).optional(),
      verification: z.object({ status: z.string().optional() }).optional(),
    })
    .optional(),
});
const domainSearchResponseSchema = z.object({
  data: z
    .object({
      domain: z.string().optional(),
      organization: z.string().optional(),
      emails: z
        .array(
          z.object({
            value: z.string(),
            type: z.string().optional(),
            confidence: z.number().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
const emailVerifierResponseSchema = z.object({
  data: z
    .object({
      status: z.string().optional(),
      result: z.string().optional(),
      score: z.number().optional(),
      regexp: z.boolean().optional(),
      smtp_check: z.boolean().optional(),
      disposable: z.boolean().optional(),
    })
    .optional(),
});
type EmailFinderResponse = z.output<typeof emailFinderResponseSchema>;
type DomainSearchResponse = z.output<typeof domainSearchResponseSchema>;
type EmailVerifierResponse = z.output<typeof emailVerifierResponseSchema>;

function extractDomain(urlOrDomain: string | undefined): string | undefined {
  if (!urlOrDomain) return undefined;
  try {
    const parsed = new URL(urlOrDomain.startsWith("http") ? urlOrDomain : `https://${urlOrDomain}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return urlOrDomain.replace(/^www\./, "");
  }
}

async function domainFromNotionPage(pageId: string): Promise<string | undefined> {
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!("properties" in page)) return undefined;
  const website = page.properties.Website;
  if (website?.type === "url" && website.url !== null) {
    return extractDomain(website.url);
  }
  const email = page.properties.Email;
  if (email?.type === "email" && email.email !== null) {
    const at = email.email.indexOf("@");
    if (at !== -1) return email.email.slice(at + 1);
  }
  return undefined;
}

export const find_email_for_lead = defineTool({
  description: `Look up an email address via Hunter. If full_name is provided, uses /v2/email-finder with the domain. Otherwise uses /v2/domain-search. You may pass a Notion page_id to derive the domain from the Company's Website property.`,
  access: { risk: "read" },
  input: z.strictObject({
    domain: z.string().optional().describe("Company domain (e.g. example.com)"),
    page_id: z.string().optional().describe("Notion page id to read Website from"),
    full_name: z.string().optional().describe("Full name of target contact"),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  }),
  execute: async ({ domain, page_id, full_name, first_name, last_name }) => {
    let resolvedDomain = extractDomain(domain);
    if (!resolvedDomain && page_id) {
      resolvedDomain = await domainFromNotionPage(page_id);
    }
    if (!resolvedDomain) {
      return { error: "No domain provided and none derivable from page_id" };
    }

    if (full_name || (first_name && last_name)) {
      const params: Record<string, string | undefined> = { domain: resolvedDomain };
      if (full_name) params.full_name = full_name;
      if (first_name) params.first_name = first_name;
      if (last_name) params.last_name = last_name;
      const result: EmailFinderResponse = await hunter(
        "email-finder",
        params,
        emailFinderResponseSchema,
      );
      return {
        domain: resolvedDomain,
        email: result.data?.email ?? ABSENT,
        score: result.data?.score ?? ABSENT,
        verification: result.data?.verification?.status ?? ABSENT,
      };
    }

    const result: DomainSearchResponse = await hunter(
      "domain-search",
      { domain: resolvedDomain, limit: "10" },
      domainSearchResponseSchema,
    );
    return {
      domain: resolvedDomain,
      organization: result.data?.organization ?? ABSENT,
      emails: (result.data?.emails ?? []).map((e) => ({
        value: e.value,
        type: e.type ?? ABSENT,
        confidence: e.confidence ?? ABSENT,
      })),
    };
  },
});

export const verify_email = defineTool({
  description: `Verify an email address via Hunter /v2/email-verifier. Returns status ("deliverable", "undeliverable", "risky", "unknown") plus score. Treat "risky" and "undeliverable" as blockers unless the user overrides.`,
  access: { risk: "read" },
  input: z.strictObject({
    email: z.email(),
  }),
  execute: async ({ email }) => {
    const result: EmailVerifierResponse = await hunter(
      "email-verifier",
      { email },
      emailVerifierResponseSchema,
    );
    return {
      email,
      status: result.data?.status ?? ABSENT,
      result: result.data?.result ?? ABSENT,
      score: result.data?.score ?? ABSENT,
      disposable: result.data?.disposable ?? ABSENT,
    };
  },
});
