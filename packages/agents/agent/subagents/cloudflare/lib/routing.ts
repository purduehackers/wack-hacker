import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { accountId, cloudflare } from "./client.ts";
import { ruleId, zoneId } from "./fields.ts";

/**
 * Email Routing forwards inbound mail for a zone to addresses elsewhere. A rule
 * matches a recipient address and either forwards it, drops it, or hands it to a
 * Worker; the catch-all rule handles everything no other rule matched.
 *
 * Destination addresses are account-scoped and must be verified by the owner
 * clicking a link in a confirmation email before a rule can forward to them, so
 * creating an address and creating a rule are two separate steps that cannot be
 * collapsed.
 */

const forwardTo = z
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

const routingRuleListSchema = z.looseObject({
  success: z.boolean(),
  result: z.array(routingRuleSchema),
});

export const get_routing_settings = defineTool({
  description:
    "Read Email Routing status for a zone — whether it is enabled, and whether the required MX records are in place.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => JSON.stringify(await cloudflare().emailRouting.get({ zone_id })),
});

export const enable_email_routing = defineTool({
  description:
    "Turn Email Routing on for a zone. This takes over the zone's MX records — any existing mail provider on that domain stops receiving mail.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) =>
    JSON.stringify(await cloudflare().emailRouting.enable({ zone_id, body: {} })),
});

export const disable_email_routing = defineTool({
  description:
    "Turn Email Routing off for a zone. All inbound mail to the domain stops being forwarded immediately.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) =>
    JSON.stringify(await cloudflare().emailRouting.disable({ zone_id, body: {} })),
});

export const list_routing_rules = defineTool({
  description:
    "List every Email Routing rule for a zone — which addresses forward where, in priority order. Start here when asked what happens to mail for a given address.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => {
    // The SDK maps create/get/update/delete for rules but not list, so this one
    // goes through the generic request method and is parsed here rather than
    // being trusted as whatever the caller declares it to be.
    const raw = await cloudflare().get(`/zones/${zone_id}/email/routing/rules`);
    const parsed = routingRuleListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamError({
        service: "Cloudflare",
        status: 502,
        detail: `unexpected rules response: ${z.prettifyError(parsed.error)}`,
      });
    }
    return JSON.stringify(parsed.data.result);
  },
});

export const get_routing_rule = defineTool({
  description: "Retrieve one Email Routing rule by id.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId, rule_id: ruleId }),
  execute: async ({ zone_id, rule_id }) =>
    JSON.stringify(await cloudflare().emailRouting.rules.get(rule_id, { zone_id })),
});

export const create_routing_rule = defineTool({
  description:
    "Forward one address to one or more verified destinations. The destinations must already exist and be verified — create them with create_destination_address first.",
  access: { risk: "write" },
  input: z.strictObject({
    zone_id: zoneId,
    match_address: z
      .email()
      .describe("The address on this domain to match, e.g. hello@example.com"),
    forward_to: forwardTo,
    name: z.string().optional(),
    enabled: z.boolean().default(true),
    priority: z.int().min(0).max(2_147_483_647).optional(),
  }),
  execute: async ({ zone_id, match_address, forward_to, name, enabled, priority }) =>
    JSON.stringify(
      await cloudflare().emailRouting.rules.create({
        zone_id,
        matchers: [{ type: "literal", field: "to", value: match_address }],
        actions: [{ type: "forward", value: forward_to }],
        enabled,
        ...(name === undefined ? {} : { name }),
        ...(priority === undefined ? {} : { priority }),
      }),
    ),
});

export const update_routing_rule = defineTool({
  description:
    "Replace an Email Routing rule's match and destinations. The whole rule is overwritten, so pass the full intended state.",
  access: { risk: "write" },
  input: z.strictObject({
    zone_id: zoneId,
    rule_id: ruleId,
    match_address: z.email(),
    forward_to: forwardTo,
    name: z.string().optional(),
    enabled: z.boolean().default(true),
    priority: z.int().min(0).max(2_147_483_647).optional(),
  }),
  execute: async ({ zone_id, rule_id, match_address, forward_to, name, enabled, priority }) =>
    JSON.stringify(
      await cloudflare().emailRouting.rules.update(rule_id, {
        zone_id,
        matchers: [{ type: "literal", field: "to", value: match_address }],
        actions: [{ type: "forward", value: forward_to }],
        enabled,
        ...(name === undefined ? {} : { name }),
        ...(priority === undefined ? {} : { priority }),
      }),
    ),
});

export const delete_routing_rule = defineTool({
  description:
    "Delete an Email Routing rule. Mail to that address then falls through to the catch-all, which may be a drop — read get_catch_all_rule before deleting so you can say where the mail will actually go.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId, rule_id: ruleId }),
  execute: async ({ zone_id, rule_id }) =>
    JSON.stringify(await cloudflare().emailRouting.rules.delete(rule_id, { zone_id })),
});

export const get_catch_all_rule = defineTool({
  description:
    "Read the catch-all rule — what happens to mail for any address on the domain that no other rule matched.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) =>
    JSON.stringify(await cloudflare().emailRouting.rules.catchAlls.get({ zone_id })),
});

export const update_catch_all_rule = defineTool({
  description:
    "Set the catch-all behavior for a domain: forward everything unmatched to verified destinations, or drop it. Dropping silently discards mail sent to any address without its own rule.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    zone_id: zoneId,
    action: z.literal(["forward", "drop"]),
    forward_to: z.array(z.email()).describe("Required when action is forward; ignored for drop"),
    enabled: z.boolean().default(true),
    name: z.string().optional(),
  }),
  execute: async ({ zone_id, action, forward_to, enabled, name }) => {
    if (action === "forward" && forward_to.length === 0) {
      throw new UpstreamError({
        service: "Cloudflare",
        status: 400,
        detail: "forward_to must list at least one destination when action is forward",
      });
    }
    return JSON.stringify(
      await cloudflare().emailRouting.rules.catchAlls.update({
        zone_id,
        matchers: [{ type: "all" }],
        actions: action === "drop" ? [{ type: "drop" }] : [{ type: "forward", value: forward_to }],
        enabled,
        ...(name === undefined ? {} : { name }),
      }),
    );
  },
});

export const list_destination_addresses = defineTool({
  description:
    "List the account's Email Routing destination addresses and whether each one is verified. Only verified addresses can receive forwarded mail.",
  access: { risk: "read" },
  input: z.strictObject({
    verified_only: z.boolean().default(false),
  }),
  execute: async ({ verified_only }) => {
    const page = await cloudflare().emailRouting.addresses.list({
      account_id: accountId(),
      ...(verified_only ? { verified: true } : {}),
    });
    return JSON.stringify(page.result);
  },
});

export const get_destination_address = defineTool({
  description: "Retrieve one destination address by id.",
  access: { risk: "read" },
  input: z.strictObject({ address_id: z.string().min(1) }),
  execute: async ({ address_id }) =>
    JSON.stringify(
      await cloudflare().emailRouting.addresses.get(address_id, { account_id: accountId() }),
    ),
});

export const create_destination_address = defineTool({
  description:
    "Add a destination address. Cloudflare emails the owner a confirmation link and the address cannot receive forwarded mail until they click it, so tell the user to go check that inbox.",
  access: { risk: "write" },
  input: z.strictObject({ email: z.email() }),
  execute: async ({ email }) =>
    JSON.stringify(
      await cloudflare().emailRouting.addresses.create({ account_id: accountId(), email }),
    ),
});

export const delete_destination_address = defineTool({
  description:
    "Remove a destination address from the account. Any routing rule still forwarding to it stops delivering.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ address_id: z.string().min(1) }),
  execute: async ({ address_id }) =>
    JSON.stringify(
      await cloudflare().emailRouting.addresses.delete(address_id, { account_id: accountId() }),
    ),
});

export const get_routing_dns = defineTool({
  description:
    "Show the DNS records Email Routing needs on a zone, and whether they are currently present and correct.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) =>
    JSON.stringify(await cloudflare().emailRouting.dns.get({ zone_id })),
});
