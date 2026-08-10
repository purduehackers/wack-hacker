import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";

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
