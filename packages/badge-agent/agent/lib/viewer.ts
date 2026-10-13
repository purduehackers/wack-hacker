import { createHmac } from "node:crypto";

import { env } from "@repo/agents/env";
import { viewerPage } from "@repo/badge-renderer";
import type { BadgeStore, Review } from "@repo/badges";
import { stockMaterial } from "@repo/badges/materials";
import { bearerMatches } from "@repo/shared/bearer";
import { z } from "zod";

const viewSchema = z.strictObject({
  asset: z.string().regex(/^[a-f0-9]{64}$/u),
  material: z.string().max(100),
  thickness: z.coerce.number().positive().max(100),
  signature: z.string().max(100),
});
type View = z.output<typeof viewSchema>;

function signature(view: Omit<View, "signature">): string {
  return createHmac("sha256", env.AGENT_INGRESS_SECRET)
    .update(`badge-view:${view.asset}:${view.material}:${view.thickness}`)
    .digest("base64url");
}

export function viewerUrl(review: Review, origin: string): string | undefined {
  const model = review.manufacturing?.badge3d;
  if (!review.manufacturing || !model?.materialId || !model.thicknessMm) return;
  const view = {
    asset: review.manufacturing.badge,
    material: model.materialId,
    thickness: model.thicknessMm,
  };
  const url = new URL("/badges/view", origin);
  for (const [key, value] of Object.entries({ ...view, signature: signature(view) }))
    url.searchParams.set(key, String(value));
  return url.href;
}

export async function viewBadge(request: Request, store: BadgeStore): Promise<Response> {
  const parsed = viewSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success || !bearerMatches(`Bearer ${parsed.data.signature}`, signature(parsed.data)))
    return new Response(
      "This preview link is unavailable. Open the latest badge message in Discord.",
      { status: 404 },
    );
  const material = stockMaterial(parsed.data.material);
  if (!material || material.id === "stamp-rubber")
    return new Response("Preview unavailable.", { status: 404 });
  const asset = await store.asset(parsed.data.asset);
  if (asset.mediaType !== "image/svg+xml")
    return new Response("Preview unavailable.", { status: 404 });
  return viewerPage({
    svg: asset.bytes.toString("utf8"),
    material,
    thicknessMm: parsed.data.thickness,
  });
}
