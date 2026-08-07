import { z } from "zod";

import {
  cmsAdminUrl,
  paginationQuery,
  payload,
  type PayloadDocument,
  wrapPayloadError,
} from "./client.ts";
import { paginationInputShape } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

const COLLECTION = "emails";

type PayloadEmail = PayloadDocument<"emails">;

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

export const list_emails = defineTool({
  name: "list_emails",
  domain: "cms",
  description:
    "List email blast records. These are the `emails` collection rows — each is a subject/body tied to an event, with a `send` flag and `sentAt` timestamp when fired.",
  access: { risk: "read" },
  input: z.object({
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
        docs: res.docs.map(projectEmail),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_email = defineTool({
  name: "get_email",
  domain: "cms",
  description: "Fetch a single email blast record by ID.",
  access: { risk: "read" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({ collection: COLLECTION, id });
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_email = defineTool({
  name: "create_email",
  domain: "cms",
  description:
    "Draft a new email blast tied to an event. `send: false` by default — the message won't fire until `send_email` flips the flag. Use this to prepare copy before getting approval to send.",
  access: { risk: "write" },
  input: z.object({
    event_id: z.union([z.string(), z.number()]),
    subject: z.string(),
    body: z.string().describe("Plain-text or HTML email body"),
  }),
  execute: async ({ event_id, subject, body }) => {
    try {
      const doc = await payload.create({
        collection: COLLECTION,
        data: { event: event_id, subject, body, send: false },
      });
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_email = defineTool({
  name: "update_email",
  domain: "cms",
  description:
    "Update an email draft's subject/body or retarget it to a different event. Does NOT fire the email — use `send_email` for that.",
  access: { risk: "write" },
  input: z.object({
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
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data,
      });
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_email = defineTool({
  name: "delete_email",
  domain: "cms",
  description: "Delete an email draft record permanently.",
  access: { risk: "destructive" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.delete({ collection: COLLECTION, id });
      return JSON.stringify({ deleted: true, id: doc.id ?? id });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const send_email = defineTool({
  name: "send_email",
  domain: "cms",
  description:
    "Fire the email blast (flips `send: true`, Payload's afterChange hook dispatches real emails via Resend, then resets send to false). Destructive external side effect — confirm the draft is final before calling.",
  access: { risk: "destructive" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data: { send: true },
      });
      return JSON.stringify({ triggered: true, ...projectEmail(doc) });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
