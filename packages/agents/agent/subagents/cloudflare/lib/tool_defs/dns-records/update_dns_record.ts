import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { recordInput, zoneId } from "../../constants.ts";

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
        ...(comment !== undefined && { comment }),
        ...(proxied !== undefined && { proxied }),
        ...(priority !== undefined && { priority }),
      }),
    ),
});
