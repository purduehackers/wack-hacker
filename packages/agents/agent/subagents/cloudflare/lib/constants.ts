import { z } from "zod";

/**
 * Input fields and response shapes shared across this domain's tools.
 *
 * Cloudflare scopes DNS and Email Routing per zone and Email Sending per
 * account, so nearly every tool takes a zone id. Declaring it once keeps the
 * description identical everywhere. The model should always learn it can get
 * one from `list_zones`, not only in the tools that happen to say so.
 */

export const zoneId = z
  .string()
  .min(1)
  .describe("Cloudflare zone id — resolve a domain name to one with list_zones");

/** The record types this domain can round-trip as a plain `content` string. */
export const recordType = z
  .literal(["A", "AAAA", "CNAME", "MX", "NS", "TXT"])
  .describe("DNS record type");

export const ruleId = z.string().min(1).describe("Email Routing rule id");

export const forwardTo = z
  .array(z.email())
  .min(1)
  .describe("Verified destination addresses to forward to");

/** Cloudflare returns rules from a paginated list endpoint the SDK does not map. */
const routingRuleSchema = z.looseObject({
  id: z.string(),
  tag: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().optional(),
  matchers: z.array(
    z.looseObject({ type: z.string(), field: z.string().optional(), value: z.string().optional() }),
  ),
  actions: z.array(z.looseObject({ type: z.string(), value: z.array(z.string()).optional() })),
});

export const routingRuleListSchema = z.looseObject({
  success: z.boolean(),
  result: z.array(routingRuleSchema),
});

/**
 * The DNS record fields a write tool accepts.
 *
 * The SDK's create parameter is a 21-member union discriminated on `type`,
 * several of whose members need structured `data` rather than a string. This
 * narrows to the six types that carry a plain `content` string, which covers
 * everything web and mail setup needs. That set includes the MX and TXT
 * records SPF, DKIM and DMARC live in. A model asking for CAA or SVCB gets a
 * schema rejection naming the supported set rather than a malformed request.
 */
export const recordInput = {
  name: z.string().min(1).describe("Record name, e.g. `mail.example.com` or `@` for the apex"),
  type: recordType,
  content: z.string().min(1).describe("Record value"),
  ttl: z.int().min(60).max(86_400).default(3600).describe("Seconds; 1 means automatic"),
  comment: z.string().optional().describe("Free-text note stored alongside the record"),
  proxied: z.boolean().optional().describe("Route through Cloudflare's proxy (A/AAAA/CNAME only)"),
  priority: z.int().min(0).max(65_535).optional().describe("Required for MX; ignored otherwise"),
} as const;
