import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { cloudflare } from "./client.ts";
import { zoneId } from "./fields.ts";

/**
 * Zone lookup only.
 *
 * Every other tool in this domain is scoped by zone id, and the model is given
 * domain names, so it needs a way to resolve one to the other. Creating and
 * deleting zones is deliberately absent — those move a domain's authoritative
 * DNS, which is not something to reach through a chat message.
 */

export const list_zones = defineTool({
  description:
    "List the Cloudflare zones on this account. Use this to turn a domain name into the zone id every other tool needs.",
  access: { risk: "read" },
  input: z.strictObject({
    name: z.string().optional().describe("Exact domain name to filter by, e.g. example.com"),
  }),
  execute: async ({ name }) => {
    const page = await cloudflare().zones.list(name === undefined ? {} : { name });
    return JSON.stringify(
      page.result.map((zone) => ({ id: zone.id, name: zone.name, status: zone.status })),
    );
  },
});

export const get_zone = defineTool({
  description: "Retrieve one zone's details by id, including status and nameservers.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => JSON.stringify(await cloudflare().zones.get({ zone_id })),
});
