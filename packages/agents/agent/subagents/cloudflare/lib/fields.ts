import { z } from "zod";

/**
 * Shared input fields.
 *
 * Cloudflare scopes DNS and Email Routing per zone and Email Sending per
 * account, so nearly every tool takes a zone id. Declaring it once keeps the
 * description identical everywhere — the model should always learn it can get
 * one from `list_zones` rather than being told so in only some tools.
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
