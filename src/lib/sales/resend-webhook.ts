import type { UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints";

import { log } from "evlog";

import { companiesDataSourceId, contactsDataSourceId, notion } from "@/lib/ai/tools/sales/client";

/**
 * Resend sends Svix-style payloads: `{ type: "email.delivered", created_at, data: { email_id, ... } }`.
 * See https://resend.com/docs/dashboard/webhooks/event-types for the full event catalog.
 */
interface ResendEvent {
  type: string;
  created_at: string;
  data: { email_id: string; [key: string]: unknown };
}

type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained";

type OutreachStatus = "Sent" | "Delivered" | "Opened" | "Clicked" | "Bounced";

const STATUS_BY_EVENT: Record<ResendEventType, OutreachStatus> = {
  "email.sent": "Sent",
  "email.delivered": "Delivered",
  "email.opened": "Opened",
  "email.clicked": "Clicked",
  "email.bounced": "Bounced",
  "email.complained": "Bounced",
};

const STATUS_RANK: Record<OutreachStatus, number> = {
  Sent: 1,
  Delivered: 2,
  Opened: 3,
  Clicked: 4,
  Bounced: 5,
};

function isResendEvent(input: unknown): input is ResendEvent {
  if (!input || typeof input !== "object") return false;
  const e = input as Partial<ResendEvent>;
  return (
    typeof e.type === "string" &&
    typeof e.created_at === "string" &&
    typeof e.data === "object" &&
    e.data !== null &&
    typeof (e.data as { email_id?: unknown }).email_id === "string"
  );
}

async function findPageByEmailId(
  dataSourceId: string,
  emailId: string,
): Promise<{ id: string; properties: Record<string, unknown> } | null> {
  const result = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      property: "Last Outreach ID",
      rich_text: { equals: emailId },
    },
    page_size: 1,
  });
  const [page] = result.results;
  if (!page || !("properties" in page)) return null;
  return { id: page.id, properties: page.properties as Record<string, unknown> };
}

function currentStatus(properties: Record<string, unknown>): OutreachStatus | null {
  const statusProp = properties["Outreach Status"] as
    | { type?: string; select?: { name?: string } | null }
    | undefined;
  const name = statusProp?.select?.name;
  if (!name) return null;
  return name in STATUS_RANK ? (name as OutreachStatus) : null;
}

function currentEventAt(properties: Record<string, unknown>): string | null {
  const dateProp = properties["Outreach Last Event At"] as
    | { type?: string; date?: { start?: string } | null }
    | undefined;
  return dateProp?.date?.start ?? null;
}

export async function applyResendEvent(raw: unknown): Promise<void> {
  if (!isResendEvent(raw)) {
    log.warn("resend", `Discarded event — shape does not match ResendEvent`);
    return;
  }
  if (!(raw.type in STATUS_BY_EVENT)) {
    log.info("resend", `Ignoring unsupported event type ${raw.type}`);
    return;
  }

  const eventType = raw.type as ResendEventType;
  const nextStatus = STATUS_BY_EVENT[eventType];
  const emailId = raw.data.email_id;

  const page =
    (await findPageByEmailId(companiesDataSourceId(), emailId)) ??
    (await findPageByEmailId(contactsDataSourceId(), emailId));
  if (!page) {
    log.info("resend", `No Notion row matches email_id ${emailId} (${eventType})`);
    return;
  }

  const currentRank = STATUS_RANK[currentStatus(page.properties) ?? "Sent"];
  const applyStatus = STATUS_RANK[nextStatus] >= currentRank;
  const shouldBlock = eventType === "email.bounced" || eventType === "email.complained";

  const existingEventAt = currentEventAt(page.properties);
  const applyEventAt = !existingEventAt || raw.created_at > existingEventAt;

  const properties: Record<string, unknown> = {};
  if (applyEventAt) {
    properties["Outreach Last Event At"] = { date: { start: raw.created_at } };
  }
  if (applyStatus) {
    properties["Outreach Status"] = { select: { name: nextStatus } };
  }
  if (shouldBlock) {
    properties["Do Not Contact"] = { checkbox: true };
  }

  if (Object.keys(properties).length === 0) {
    log.info("resend", `No-op for ${emailId} (${eventType}) — already newer state`);
    return;
  }

  await notion.pages.update({ page_id: page.id, properties } as UpdatePageParameters);
}
