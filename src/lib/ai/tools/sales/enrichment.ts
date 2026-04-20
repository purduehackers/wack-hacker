import { tool } from "ai";
import { z } from "zod";

import { hunter, notion } from "./client.ts";

interface EmailFinderResponse {
  data?: {
    email?: string | null;
    score?: number;
    sources?: Array<{ domain: string; uri: string }>;
    verification?: { status?: string };
  };
}

interface DomainSearchResponse {
  data?: {
    domain?: string;
    organization?: string;
    emails?: Array<{ value: string; type?: string; confidence?: number }>;
  };
}

interface EmailVerifierResponse {
  data?: {
    status?: string;
    result?: string;
    score?: number;
    regexp?: boolean;
    smtp_check?: boolean;
    disposable?: boolean;
  };
}

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
  const props = page.properties as Record<string, { type?: string; [key: string]: unknown }>;
  const website = props.Website;
  if (website && website.type === "url" && typeof website.url === "string") {
    return extractDomain(website.url);
  }
  const email = props.Email;
  if (email && email.type === "email" && typeof email.email === "string") {
    const at = email.email.indexOf("@");
    if (at !== -1) return email.email.slice(at + 1);
  }
  return undefined;
}

export const find_email_for_lead = tool({
  description: `Look up an email address via Hunter. If full_name is provided, uses /v2/email-finder with the domain. Otherwise uses /v2/domain-search. You may pass a Notion page_id to derive the domain from the Company's Website property.`,
  inputSchema: z.object({
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
      return JSON.stringify({ error: "No domain provided and none derivable from page_id" });
    }

    if (full_name || (first_name && last_name)) {
      const params: Record<string, string | undefined> = { domain: resolvedDomain };
      if (full_name) params.full_name = full_name;
      if (first_name) params.first_name = first_name;
      if (last_name) params.last_name = last_name;
      const result = await hunter<EmailFinderResponse>("email-finder", params);
      return JSON.stringify({
        domain: resolvedDomain,
        email: result.data?.email ?? null,
        score: result.data?.score ?? null,
        verification: result.data?.verification?.status ?? null,
      });
    }

    const result = await hunter<DomainSearchResponse>("domain-search", {
      domain: resolvedDomain,
      limit: "10",
    });
    return JSON.stringify({
      domain: resolvedDomain,
      organization: result.data?.organization ?? null,
      emails: (result.data?.emails ?? []).map((e) => ({
        value: e.value,
        type: e.type ?? null,
        confidence: e.confidence ?? null,
      })),
    });
  },
});

export const verify_email = tool({
  description: `Verify an email address via Hunter /v2/email-verifier. Returns status ("deliverable", "undeliverable", "risky", "unknown") plus score. Treat "risky" and "undeliverable" as blockers unless the user overrides.`,
  inputSchema: z.object({
    email: z.email(),
  }),
  execute: async ({ email }) => {
    const result = await hunter<EmailVerifierResponse>("email-verifier", { email });
    return JSON.stringify({
      email,
      status: result.data?.status ?? null,
      result: result.data?.result ?? null,
      score: result.data?.score ?? null,
      disposable: result.data?.disposable ?? null,
    });
  },
});
