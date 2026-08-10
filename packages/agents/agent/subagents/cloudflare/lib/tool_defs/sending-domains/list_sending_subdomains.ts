import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

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
