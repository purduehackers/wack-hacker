import { agentArtifacts, getDb } from "@repo/shared/db";
import { del } from "@vercel/blob";
import { and, eq, isNull, lt } from "drizzle-orm";

import { env, tursoConfig } from "../../env.ts";

/** Public media and explicitly retained reports remain pinned. */
export async function cleanupArtifacts() {
  if (!env.ARTIFACT_READ_WRITE_TOKEN) return;
  const db = getDb(tursoConfig());
  const expired = await db
    .select()
    .from(agentArtifacts)
    .where(
      and(
        eq(agentArtifacts.retained, false),
        isNull(agentArtifacts.publicUrl),
        lt(agentArtifacts.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(500);
  for (const artifact of expired) {
    await del(artifact.pathname, { token: env.ARTIFACT_READ_WRITE_TOKEN });
    await db.delete(agentArtifacts).where(eq(agentArtifacts.id, artifact.id));
  }
}
