/* oxlint-disable unicorn/no-null -- Hunter projections use null to represent external fields with no value. */
import { z } from "zod";

import { hunter, notion } from "./client.ts";
import { defineTool } from "./define-tool.ts";

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
type EmailFinderResponse = z.infer<typeof emailFinderResponseSchema>;
type DomainSearchResponse = z.infer<typeof domainSearchResponseSchema>;
type EmailVerifierResponse = z.infer<typeof emailVerifierResponseSchema>;

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
  name: "find_email_for_lead",
  domain: "outreach",
  description: `Look up an email address via Hunter. If full_name is provided, uses /v2/email-finder with the domain. Otherwise uses /v2/domain-search. You may pass a Notion page_id to derive the domain from the Company's Website property.`,
  access: { risk: "read" },
  input: z.object({
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
        email: result.data?.email ?? null,
        score: result.data?.score ?? null,
        verification: result.data?.verification?.status ?? null,
      };
    }

    const result: DomainSearchResponse = await hunter(
      "domain-search",
      { domain: resolvedDomain, limit: "10" },
      domainSearchResponseSchema,
    );
    return {
      domain: resolvedDomain,
      organization: result.data?.organization ?? null,
      emails: (result.data?.emails ?? []).map((e) => ({
        value: e.value,
        type: e.type ?? null,
        confidence: e.confidence ?? null,
      })),
    };
  },
});

export const verify_email = defineTool({
  name: "verify_email",
  domain: "outreach",
  description: `Verify an email address via Hunter /v2/email-verifier. Returns status ("deliverable", "undeliverable", "risky", "unknown") plus score. Treat "risky" and "undeliverable" as blockers unless the user overrides.`,
  access: { risk: "read" },
  input: z.object({
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
      status: result.data?.status ?? null,
      result: result.data?.result ?? null,
      score: result.data?.score ?? null,
      disposable: result.data?.disposable ?? null,
    };
  },
});
