import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { recordInput, zoneId } from "../../constants.ts";

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
        ...(comment !== undefined && { comment }),
        ...(proxied !== undefined && { proxied }),
        ...(priority !== undefined && { priority }),
      }),
    ),
});
