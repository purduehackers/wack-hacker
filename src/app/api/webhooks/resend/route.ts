import { log } from "evlog";
import { Webhook, WebhookVerificationError } from "svix";

import { ConversationStore } from "@/bot/store";
import { env } from "@/env";
import { applyResendEvent } from "@/lib/sales/resend-webhook";

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let event: unknown;
  try {
    event = new Webhook(env.RESEND_WEBHOOK_SECRET).verify(body, headers);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      log.warn("resend", `Signature verification failed: ${err.message}`);
      return new Response("invalid signature", { status: 401 });
    }
    throw err;
  }

  const svixId = headers["svix-id"];
  if (svixId) {
    const store = new ConversationStore();
    if (!(await store.dedup(`resend:${svixId}`))) {
      log.info("resend", `Dedup hit for ${svixId}, skipping`);
      return new Response("ok", { status: 200 });
    }
  }

  try {
    await applyResendEvent(event);
  } catch (err) {
    log.error(
      "resend",
      `Failed to apply event: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return new Response("ok", { status: 200 });
}
