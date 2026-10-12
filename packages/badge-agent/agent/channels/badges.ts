import { env } from "@repo/agents/env";
import type { Review } from "@repo/badges/contracts";
import { currentDecisions, reviewStep } from "@repo/badges/presentation";
import { renderSvg } from "@repo/badges/svg";
import { actionRequest, componentId } from "@repo/badges/wire";
import { bearerMatches } from "@repo/shared/bearer";
import { messageOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { decodeMessagePayload } from "@repo/shared/wire";
import { defineChannel, POST } from "eve/channels";
import { z } from "zod";

import { cms } from "../lib/cms.ts";
import { routeMessage } from "../lib/routing.ts";
import { runtime } from "../lib/runtime.ts";

async function protectedRoute(
  request: Request,
  action: () => Promise<Response>,
): Promise<Response> {
  if (!bearerMatches(request.headers.get("authorization") ?? undefined, env.AGENT_INGRESS_SECRET))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return await action();
  } catch (cause) {
    return Response.json({ error: messageOf(cause).slice(0, 1500) }, { status: 409 });
  }
}

const acknowledgement = z.strictObject({
  id: z.string(),
  lease: z.uuid(),
  reviewId: z.uuid(),
  messageId: z.string(),
  version: z.int().nonnegative(),
});

async function previewFiles(review: Review) {
  const files: { name: string; data: string }[] = [];
  const step = reviewStep(review);
  if (
    currentDecisions(review).some((item) => item.criterion === step && item.verdict !== "approve")
  )
    return files;
  if (step === "files") {
    for (const [i, upload] of review.uploads.entries())
      files.push({
        name: `${i === 0 ? "A" : "B"}.png`,
        data: Buffer.from(
          renderSvg((await runtime().store.asset(upload.hash)).bytes.toString("utf8")),
        ).toString("base64"),
      });
    return files;
  }
  const images: { name: string; hash: string | undefined }[] = [];
  if (step === "layout")
    images.push(
      ...review.layouts.map((layout, i) => ({
        name: `option-${i + 1}-${layout.count}-badges.png`,
        hash: layout.preview,
      })),
    );
  if (["version", "date", "physical"].includes(step))
    images.push(
      { name: "badge.png", hash: review.previews[0] },
      ...review.previews
        .slice(2)
        .map((digest, i) => ({ name: `close-up-${i + 1}.png`, hash: digest })),
    );
  if (step === "stamp")
    images.push(
      { name: "stamp-source.png", hash: review.previews[1] },
      { name: "stamp-output.png", hash: review.manufacturing?.stampPreview },
    );
  if (step === "fix")
    for (const [i, role] of ["badge", "stamp"].entries())
      if (review.checks.some((finding) => finding.role === role && finding.status !== "pass"))
        images.push({ name: `${role}.png`, hash: review.previews[i] });
  for (const asset of images)
    if (asset.hash)
      files.push({
        name: asset.name,
        data: (await runtime().store.asset(asset.hash)).bytes.toString("base64"),
      });
  return files;
}
export default defineChannel({
  routes: [
    POST("/badges/route", (request) =>
      protectedRoute(request, async () => {
        const decoded = decodeMessagePayload(await request.json());
        if (Result.isError(decoded)) throw new Error("Invalid Discord payload.");
        return Response.json({ route: await routeMessage(decoded.value) });
      }),
    ),
    POST("/badges/action", (request) =>
      protectedRoute(request, async () => {
        const input = actionRequest.parse(await request.json());
        const action = input.control.split(":")[3];
        if (
          !action ||
          !bearerMatches(
            `Bearer ${input.control}`,
            componentId(input.id, input.version, action, env.AGENT_INGRESS_SECRET),
          )
        )
          throw new Error("Invalid review control.");
        // The signed control is a capability for its displayed action, not for arbitrary commands.
        const expected =
          input.action.kind === "decision"
            ? input.action.criterion
            : input.action.kind === "roles"
              ? `roles${input.action.badge}`
              : input.action.kind === "replace"
                ? input.action.role
                : input.action.kind;
        if (action !== expected) throw new Error("This control cannot perform that action.");
        return Response.json(
          await runtime().service.action(
            input.id,
            input.version,
            input.actor,
            input.action,
            `discord:${input.eventId}`,
          ),
        );
      }),
    ),
    POST("/badges/work", (request) =>
      protectedRoute(request, async () => {
        await runtime().worker.process();
        // Several jobs may describe the same latest state. Deliver it only once.
        for (let skipped = 0; skipped < 20; skipped += 1) {
          const job = await runtime().store.claim(true);
          if (!job) return Response.json({});
          const stored = await runtime().store.get(job.reviewId);
          if (stored && (stored.review.cardVersion ?? -1) < stored.version)
            return Response.json({
              card: {
                ...stored,
                events: stored.review.rolesConfirmed ? await cms.events() : [],
                files: await previewFiles(stored.review),
                jobId: job.id,
                lease: job.lease,
              },
            });
          await runtime().store.finish(job.id, job.lease);
        }
        return Response.json({});
      }),
    ),
    POST("/badges/ack", (request) =>
      protectedRoute(request, async () => {
        const input = acknowledgement.parse(await request.json());
        if (!input.id.startsWith(`${input.reviewId}:render:`))
          throw new Error("Invalid render receipt.");
        await runtime().store.card(input.reviewId, input.messageId, input.version);
        await runtime().store.finish(input.id, input.lease);
        return Response.json({ ok: true });
      }),
    ),
  ],
});
