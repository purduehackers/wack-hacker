import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import {
  cmsAdminUrl,
  documentId,
  paginationQuery,
  payload,
  type PayloadDocument,
  relationship,
  wrapPayloadError,
} from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const COLLECTION = "emails";

type PayloadEmail = PayloadDocument<"emails">;

/** Writable email fields. `create_email` requires them; `update_email` takes the partial. */
const emailFields = {
  event_id: documentId,
  subject: z.string(),
  body: z.string().describe("Plain-text or HTML email body"),
};

function projectEmail(e: PayloadEmail) {
  return {
    id: e.id,
    event_id: relationship(e.event).id,
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
  description:
    "List email blast records. These are the `emails` collection rows — each is a subject/body tied to an event, with a `send` flag and `sentAt` timestamp when fired.",
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    event_id: documentId.optional().describe("Filter to emails tied to a specific event"),
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
  description: "Fetch a single email blast record by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
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
  description:
    "Draft a new email blast tied to an event. `send: false` by default — the message won't fire until `send_email` flips the flag. Use this to prepare copy before getting approval to send.",
  access: { risk: "write" },
  input: z.strictObject(emailFields),
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
  description:
    "Update an email draft's subject/body or retarget it to a different event. Does NOT fire the email — use `send_email` for that.",
  access: { risk: "write" },
  input: z.strictObject({ id: documentId, ...z.object(emailFields).partial().shape }),
  execute: async ({ id, event_id, subject, body }) => {
    try {
      const data = {
        ...(event_id !== undefined && { event: event_id }),
        ...(subject !== undefined && { subject }),
        ...(body !== undefined && { body }),
      };
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
  description: "Delete an email draft record permanently.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
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
  description:
    "Fire the email blast (flips `send: true`, Payload's afterChange hook dispatches real emails via Resend, then resets send to false). Destructive external side effect — confirm the draft is final before calling.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
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
