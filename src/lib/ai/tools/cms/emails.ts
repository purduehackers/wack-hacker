import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { cmsAdminUrl, paginationQuery, payload, wrapPayloadError } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const COLLECTION = "emails";

interface PayloadEmail {
  id?: number | string;
  event?: number | string | { id?: number | string };
  subject?: string;
  body?: string;
  send?: boolean;
  sentAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

function eventIdOf(event: PayloadEmail["event"]): number | string | undefined {
  if (typeof event === "object" && event !== null) return event.id;
  return event;
}

function projectEmail(e: PayloadEmail) {
  return {
    id: e.id,
    event_id: eventIdOf(e.event),
    subject: e.subject,
    body: e.body,
    send: e.send,
    sent_at: e.sentAt,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    href: e.id === undefined ? undefined : cmsAdminUrl(COLLECTION, e.id),
  };
}

export const list_emails = tool({
  description:
    "List email blast records. These are the `emails` collection rows — each is a subject/body tied to an event, with a `send` flag and `sentAt` timestamp when fired.",
  inputSchema: z.object({
    ...paginationInputShape,
    event_id: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Filter to emails tied to a specific event"),
  }),
  execute: async ({ event_id, ...input }) => {
    try {
      const res = await payload.find({
        collection: COLLECTION,
        ...paginationQuery(input),
        ...(event_id !== undefined ? { where: { event: { equals: event_id } } } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: (res.docs as PayloadEmail[]).map(projectEmail),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_email = tool({
  description: "Fetch a single email blast record by ID.",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.findByID({ collection: COLLECTION, id })) as PayloadEmail;
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_email = tool({
  description:
    "Draft a new email blast tied to an event. `send: false` by default — the message won't fire until `send_email` flips the flag. Use this to prepare copy before getting approval to send.",
  inputSchema: z.object({
    event_id: z.union([z.string(), z.number()]),
    subject: z.string(),
    body: z.string().describe("Plain-text or HTML email body"),
  }),
  execute: async ({ event_id, subject, body }) => {
    try {
      const doc = (await payload.create({
        collection: COLLECTION,
        data: { event: event_id, subject, body, send: false },
      })) as PayloadEmail;
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_email = tool({
  description:
    "Update an email draft's subject/body or retarget it to a different event. Does NOT fire the email — use `send_email` for that.",
  inputSchema: z.object({
    id: z.union([z.string(), z.number()]),
    event_id: z.union([z.string(), z.number()]).optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
  }),
  execute: async ({ id, event_id, subject, body }) => {
    try {
      const data: Record<string, unknown> = {};
      if (event_id !== undefined) data.event = event_id;
      if (subject !== undefined) data.subject = subject;
      if (body !== undefined) data.body = body;
      const doc = (await payload.update({
        collection: COLLECTION,
        id,
        data,
      })) as PayloadEmail;
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_email = approval(
  tool({
    description: "Delete an email draft record permanently.",
    inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
    execute: async ({ id }) => {
      try {
        const doc = (await payload.delete({ collection: COLLECTION, id })) as PayloadEmail;
        return JSON.stringify({ deleted: true, id: doc.id ?? id });
      } catch (err) {
        throw wrapPayloadError(err);
      }
    },
  }),
);

export const send_email = approval(
  tool({
    description:
      "Fire the email blast (flips `send: true`, Payload's afterChange hook dispatches real emails via Resend, then resets send to false). Destructive external side effect — confirm the draft is final before calling.",
    inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
    execute: async ({ id }) => {
      try {
        const doc = (await payload.update({
          collection: COLLECTION,
          id,
          data: { send: true },
        })) as PayloadEmail;
        return JSON.stringify({ triggered: true, ...projectEmail(doc) });
      } catch (err) {
        throw wrapPayloadError(err);
      }
    },
  }),
);
