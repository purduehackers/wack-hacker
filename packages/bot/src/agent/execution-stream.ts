import { Result } from "@repo/shared/result";
import { Client } from "eve/client";

import type { ConversationAgentClient, ExecutionAddress } from "./routed-client.ts";

/** One verified origin and credential issuer for the root and every local child. */
export async function createExecutionStreamClient(
  eve: ConversationAgentClient,
  address: ExecutionAddress,
): Promise<Client> {
  const access = await eve.streamAccess(address);
  if (Result.isError(access)) throw access.error;
  const client = access.value;
  return new Client({
    host: client.baseUrl,
    auth: {
      vercelOidc: {
        token: async () => {
          const token = await client.streamToken();
          // Empty auth fails at the route; never fall back to another deployment.
          return Result.isOk(token) ? token.value : "";
        },
      },
    },
    redirect: "manual",
  });
}
