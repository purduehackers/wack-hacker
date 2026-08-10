import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { accountId, cloudflare } from "./client.ts";
import { zoneId } from "./fields.ts";

/**
 * Outbound transactional mail.
 *
 * Cloudflare Email Service is transactional only — one message to a named
 * recipient. It has no audience or campaign concept, so anything resembling a
 * newsletter belongs in the CMS blast pipeline, not here.
 *
 * A sending domain is onboarded per zone and Cloudflare publishes the SPF, DKIM
 * and DMARC records under a `cf-bounce` subdomain; a domain that has not been
 * onboarded cannot be used as a From address no matter what DNS says.
 */

export const send_email = defineTool({
  description:
    "Send one transactional email from a verified sending domain. Irreversible. The From address must belong to a domain onboarded for Email Sending — check with list_sending_subdomains if unsure. For CRM outreach use the outreach subagent's send_outreach_email instead, which also records the send against the contact.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    from: z.email().describe("Must be on a domain onboarded for Email Sending"),
    to: z.array(z.email()).min(1).max(50),
    subject: z.string().min(1),
    text: z.string().min(1).describe("Plain-text body"),
    html: z.string().min(1).optional(),
    reply_to: z.email().optional(),
    cc: z.array(z.email()).optional(),
    bcc: z.array(z.email()).optional(),
  }),
  execute: async ({ from, to, subject, text, html, reply_to, cc, bcc }) => {
    const result = await cloudflare().emailSending.send({
      account_id: accountId(),
      from,
      to,
      subject,
      text,
      ...(html === undefined ? {} : { html }),
      ...(reply_to === undefined ? {} : { reply_to }),
      ...(cc === undefined ? {} : { cc }),
      ...(bcc === undefined ? {} : { bcc }),
    });
    // Permanent bounces come back in a 2xx body rather than as an error, so a
    // caller that only checks for a thrown error would report a dead address as
    // a successful send.
    return {
      message_id: result.message_id,
      delivered: result.delivered,
      queued: result.queued,
      permanent_bounces: result.permanent_bounces,
    };
  },
});

export const list_sending_subdomains = defineTool({
  description:
    "List the sending domains onboarded for Email Sending on a zone. A From address is only usable if its domain appears here.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => {
    const page = await cloudflare().emailSending.subdomains.list({ zone_id });
    return JSON.stringify(page.result);
  },
});

export const get_sending_subdomain = defineTool({
  description: "Retrieve one sending domain by id, including its verification state.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId, subdomain_id: z.string().min(1) }),
  execute: async ({ zone_id, subdomain_id }) =>
    JSON.stringify(await cloudflare().emailSending.subdomains.get(subdomain_id, { zone_id })),
});

export const create_sending_subdomain = defineTool({
  description:
    "Onboard a domain for Email Sending. Cloudflare then requires SPF, DKIM and DMARC records under cf-bounce — read them with get_sending_dns_records and create each one before sending.",
  access: { risk: "write" },
  input: z.strictObject({
    zone_id: zoneId,
    name: z.string().min(1).describe("The domain or subdomain to send from; must be in this zone"),
  }),
  execute: async ({ zone_id, name }) =>
    JSON.stringify(await cloudflare().emailSending.subdomains.create({ zone_id, name })),
});

export const delete_sending_subdomain = defineTool({
  description:
    "Remove a sending domain. Every From address on it stops working immediately, and any service still sending as that domain starts failing.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId, subdomain_id: z.string().min(1) }),
  execute: async ({ zone_id, subdomain_id }) =>
    JSON.stringify(await cloudflare().emailSending.subdomains.delete(subdomain_id, { zone_id })),
});

export const get_sending_dns_records = defineTool({
  description:
    "Show the SPF, DKIM and DMARC records a sending domain requires, so they can be created with create_dns_record.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId, subdomain_id: z.string().min(1) }),
  execute: async ({ zone_id, subdomain_id }) => {
    const page = await cloudflare().emailSending.subdomains.dns.get(subdomain_id, { zone_id });
    return JSON.stringify(page.result);
  },
});
