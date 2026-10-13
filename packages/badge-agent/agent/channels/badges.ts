import { env } from "@repo/agents/env";
import { actionable, reviewStep } from "@repo/badges/presentation";
import { actionName, actionRequest, componentId } from "@repo/badges/wire";
import { bearerMatches } from "@repo/shared/bearer";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { decodeMessagePayload } from "@repo/shared/wire";
import { defineChannel, POST } from "eve/channels";
import { z } from "zod";

import { cms } from "../lib/cms.ts";
import { identifiedPreview, previewFiles } from "../lib/previews.ts";
import { routeMessage } from "../lib/routing.ts";
import { runtime } from "../lib/runtime.ts";
import { viewerUrl } from "../lib/viewer.ts";

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
async function control(request: Request, mutate: boolean) {
  const input = actionRequest.parse(await request.json());
  const expected = componentId(
    input.id,
    input.version,
    actionName(input.action),
    env.AGENT_INGRESS_SECRET,
  );
  if (!bearerMatches(`Bearer ${input.control}`, expected))
    throw new Error("Invalid review control.");
  const service = runtime().service;
  try {
    return Response.json(
      mutate
        ? await service.action(
            input.id,
            input.version,
            input.actor,
            input.action,
            `discord:${input.eventId}`,
          )
        : await service.validate(input.id, input.version, input.actor, input.action),
    );
  } catch (cause) {
    const latest = await runtime().store.get(input.id);
    const url =
      latest?.review.threadId === input.actor.threadId &&
      input.actor.guildId === DISCORD_GUILD_ID &&
      latest.review.cardId
        ? `https://discord.com/channels/${DISCORD_GUILD_ID}/${input.actor.threadId}/${latest.review.cardId}`
        : undefined;
    return Response.json({ error: messageOf(cause), url }, { status: 409 });
  }
}
async function deliverable(origin: string) {
  const { store, worker, inventory } = runtime();
  const worked = await worker.process();
  for (let skipped = 0; skipped < 20; skipped += 1) {
    const job = await store.claim(true);
    if (!job) return Response.json({ worked });
    const stored = await store.get(job.reviewId);
    if (stored && actionable(stored.review) && (stored.review.cardVersion ?? -1) < stored.version)
      return Response.json({
        worked,
        card: {
          ...stored,
          events: reviewStep(stored.review) === "event" ? await cms.events() : [],
          materials: reviewStep(stored.review) === "material" ? await inventory.materials() : [],
          files: await previewFiles(stored.review, store),
          identifiedFile: await identifiedPreview(stored.review, store),
          viewerUrl: viewerUrl(stored.review, origin),
          jobId: job.id,
          lease: job.lease,
        },
      });
    await store.finish(job.id, job.lease);
  }
  return Response.json({ worked });
}
export default defineChannel({
  routes: [
    POST("/badges/route", (request) =>
      protectedRoute(request, async () => {
        const decoded = decodeMessagePayload(await request.json());
        if (Result.isError(decoded)) throw new Error("Invalid Discord payload.");
        const payload = decoded.value,
          route = await routeMessage(payload);
        const handled = route === "badge" && Boolean(payload.attachments?.length);
        if (handled && payload.thread)
          await runtime().service.submit(payload.messageId, payload.thread.id);
        return Response.json({ route, handled });
      }),
    ),
    POST("/badges/continue", (request) =>
      protectedRoute(request, async () => {
        const decoded = decodeMessagePayload(await request.json());
        if (Result.isError(decoded)) throw new Error("Invalid Discord payload.");
        const payload = decoded.value;
        const saved = payload.thread
          ? await runtime().store.forThread(payload.thread.id)
          : undefined;
        // Requested uploads only: unrelated chatter never creates or classifies a conversation.
        if (
          !saved ||
          saved.review.author.id !== payload.principal.userId ||
          !payload.attachments?.length ||
          (!["missing", "fix", "files"].includes(reviewStep(saved.review)) &&
            !saved.review.pendingRole)
        )
          return Response.json({ handled: false });
        await runtime().store.stage(
          payload.messageId,
          saved.review.threadId,
          JSON.stringify(payload),
        );
        await runtime().service.submit(payload.messageId, saved.review.threadId);
        return Response.json({ handled: true });
      }),
    ),
    POST("/badges/control", (request) => protectedRoute(request, () => control(request, false))),
    POST("/badges/action", (request) => protectedRoute(request, () => control(request, true))),
    POST("/badges/work", (request) => protectedRoute(request, () => deliverable(request.url))),
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
