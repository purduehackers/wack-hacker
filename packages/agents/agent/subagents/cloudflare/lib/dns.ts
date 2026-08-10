import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { cloudflare } from "./client.ts";
import { recordType, zoneId } from "./fields.ts";

/**
 * The record shape the model fills in.
 *
 * The SDK's create parameter is a 21-member union discriminated on `type`, one
 * member per RR type, several of which need structured `data` rather than a
 * string. This narrows to the six types that carry a plain `content` string,
 * which covers everything web and email setup needs — including the MX and TXT
 * records that SPF, DKIM and DMARC live in. A model asking for CAA or SVCB gets
 * a schema rejection naming the supported set rather than a malformed request.
 */
const recordInput = {
  name: z.string().min(1).describe("Record name, e.g. `mail.example.com` or `@` for the apex"),
  type: recordType,
  content: z.string().min(1).describe("Record value"),
  ttl: z.int().min(60).max(86_400).default(3600).describe("Seconds; 1 means automatic"),
  comment: z.string().optional().describe("Free-text note stored alongside the record"),
  proxied: z.boolean().optional().describe("Route through Cloudflare's proxy (A/AAAA/CNAME only)"),
  priority: z.int().min(0).max(65_535).optional().describe("Required for MX; ignored otherwise"),
} as const;

export const list_dns_records = defineTool({
  description:
    "List DNS records in a zone. Supports filtering by name and type, which is the fast way to answer 'what are the MX records' without paging the whole zone.",
  access: { risk: "read" },
  input: z.strictObject({
    zone_id: zoneId,
    name: z.string().optional().describe("Exact record name to filter by"),
    type: recordType.optional(),
    per_page: z.int().min(1).max(100).default(50),
  }),
  execute: async ({ zone_id, name, type, per_page }) => {
    const page = await cloudflare().dns.records.list({
      zone_id,
      per_page,
      ...(name === undefined ? {} : { name: { exact: name } }),
      ...(type === undefined ? {} : { type }),
    });
    return JSON.stringify(page.result);
  },
});

export const get_dns_record = defineTool({
  description: "Retrieve one DNS record by id.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId, record_id: z.string().min(1) }),
  execute: async ({ zone_id, record_id }) =>
    JSON.stringify(await cloudflare().dns.records.get(record_id, { zone_id })),
});

export const create_dns_record = defineTool({
  description:
    "Create a DNS record. Supported types: A, AAAA, CNAME, MX, NS, TXT. MX requires priority.",
  access: { risk: "write" },
  input: z.strictObject({ zone_id: zoneId, ...recordInput }),
  execute: async ({ zone_id, name, type, content, ttl, comment, proxied, priority }) =>
    JSON.stringify(
      await cloudflare().dns.records.create({
        zone_id,
        name,
        type,
        content,
        ttl,
        ...(comment === undefined ? {} : { comment }),
        ...(proxied === undefined ? {} : { proxied }),
        ...(priority === undefined ? {} : { priority }),
      }),
    ),
});

/**
 * The only way to change a record.
 *
 * Cloudflare's PATCH-shaped `edit` endpoint still requires `name`, `ttl` and
 * `type`, so a separate "patch one field" tool would differ from this one only
 * in which optional fields it silently clears — two write tools the model would
 * have to choose between for no gain. One tool, stated plainly.
 */
export const update_dns_record = defineTool({
  description:
    "Overwrite a DNS record. Every field is replaced, so any optional field you omit is cleared — read the record with get_dns_record first and pass its current values for anything you are not changing.",
  access: { risk: "write" },
  input: z.strictObject({ zone_id: zoneId, record_id: z.string().min(1), ...recordInput }),
  execute: async ({ zone_id, record_id, name, type, content, ttl, comment, proxied, priority }) =>
    JSON.stringify(
      await cloudflare().dns.records.update(record_id, {
        zone_id,
        name,
        type,
        content,
        ttl,
        ...(comment === undefined ? {} : { comment }),
        ...(proxied === undefined ? {} : { proxied }),
        ...(priority === undefined ? {} : { priority }),
      }),
    ),
});

export const delete_dns_record = defineTool({
  description:
    "Permanently delete a DNS record. Deleting an MX, SPF, DKIM or DMARC record breaks mail for the whole domain — read the record back with get_dns_record and say what it is before deleting.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId, record_id: z.string().min(1) }),
  execute: async ({ zone_id, record_id }) =>
    JSON.stringify(await cloudflare().dns.records.delete(record_id, { zone_id })),
});

export const export_zone_file = defineTool({
  description:
    "Export the whole zone as a BIND zone file. Useful as a before-picture to quote back to the user ahead of a risky change.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => await cloudflare().dns.records.export({ zone_id }),
});
