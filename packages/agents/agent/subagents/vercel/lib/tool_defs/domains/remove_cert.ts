import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const remove_cert = defineTool({
  description: "Remove a TLS certificate.",
  access: { risk: "destructive" },
  input: z.strictObject({ cert_id: z.string() }),
  execute: async ({ cert_id }) => {
    const result = await vercel().certs.removeCert({ ...TEAM, id: cert_id });
    return JSON.stringify(result);
  },
});
