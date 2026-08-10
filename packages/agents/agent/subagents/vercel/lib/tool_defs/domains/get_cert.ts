import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_cert = defineTool({
  description: "Retrieve a TLS certificate by id.",
  access: { risk: "read" },
  input: z.strictObject({ cert_id: z.string() }),
  execute: async ({ cert_id }) => {
    const result = await vercel().certs.getCertById({ ...TEAM, id: cert_id });
    return JSON.stringify(result);
  },
});
