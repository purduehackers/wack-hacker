import { parseConnectionString } from "@vercel/edge-config";

import { env } from "@/env";

export function getDashboardEdgeConfigId(): string {
  const connection = parseConnectionString(env.DASHBOARD_EDGE_CONFIG);
  if (!connection) {
    throw new Error("DASHBOARD_EDGE_CONFIG is not a valid Edge Config connection string");
  }
  return connection.id;
}
