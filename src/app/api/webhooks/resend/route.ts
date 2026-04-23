import { Webhook, WebhookVerificationError } from "svix";

import { ConversationStore } from "@/bot/store";
import { env } from "@/env";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { applyResendEvent } from "@/lib/sales/resend-webhook";

export async function POST(req: Request): Promise<Response> {
  return withSpan("webhook.resend", { "http.route": "/api/webhooks/resend" }, async () => {
    const logger = createWideLogger({
      op: "webhook.resend",
      http: { method: "POST", route: "/api/webhooks/resend" },
    });
    const startTime = Date.now();
    countMetric("webhook.resend.received");
    try {
      const body = await req.text();
      const headers = {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": req.headers.get("svix-signature") ?? "",
      };
      if (headers["svix-id"]) logger.set({ resend: { svix_id: headers["svix-id"] } });

      let event: unknown;
      try {
        event = new Webhook(env.RESEND_WEBHOOK_SECRET).verify(body, headers);
      } catch (err) {
        if (err instanceof WebhookVerificationError) {
          countMetric("webhook.resend.unauthorized");
          logger.warn("signature verification failed", { reason: err.message });
          logger.emit({ outcome: "unauthorized", duration_ms: Date.now() - startTime });
          return new Response("invalid signature", { status: 401 });
        }
        throw err;
      }

      const svixId = headers["svix-id"];
      const store = svixId ? new ConversationStore() : null;
      const dedupKey = svixId ? `resend:${svixId}` : null;

      // Claim the dedup slot. If the claim is already held, a prior delivery of
      // this event was successfully applied and we short-circuit. The claim is
      // only retained when processing succeeds — failures release it so Resend's
      // retry can attempt processing again.
      if (store && dedupKey && !(await store.dedup(dedupKey))) {
        countMetric("webhook.resend.dedup_hit");
        logger.emit({ outcome: "dedup_hit", duration_ms: Date.now() - startTime });
        return new Response("ok", { status: 200 });
      }

      try {
        await applyResendEvent(event);
      } catch (err) {
        countMetric("webhook.resend.error");
        logger.error(err as Error);
        logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
        if (store && dedupKey) await store.releaseDedup(dedupKey);
        return new Response("failed to apply event", { status: 500 });
      }

      countMetric("webhook.resend.processed");
      logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
      return new Response("ok", { status: 200 });
    } finally {
      recordDuration("webhook.resend.duration", Date.now() - startTime);
    }
  });
}
