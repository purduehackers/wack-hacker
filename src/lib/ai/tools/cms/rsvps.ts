import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { cmsAdminUrl, paginationQuery, payload, wrapPayloadError } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const COLLECTION = "rsvps";

interface PayloadRsvp {
  id?: number | string;
  email?: string;
  name?: string;
  event?: number | string | { id?: number | string };
  unsubscribed?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

function eventIdOf(event: PayloadRsvp["event"]): number | string | undefined {
  if (typeof event === "object" && event !== null) return event.id;
  return event;
}

function projectRsvp(r: PayloadRsvp) {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    event_id: eventIdOf(r.event),
    unsubscribed: r.unsubscribed,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    href: r.id === undefined ? undefined : cmsAdminUrl(COLLECTION, r.id),
  };
}

export const list_rsvps = tool({
  description:
    "List RSVPs across events. Optionally filter by event_id, email, or unsubscribed flag. Useful for attendance reports and unsubscribe audits.",
  inputSchema: z.object({
    ...paginationInputShape,
    event_id: z.union([z.string(), z.number()]).optional(),
    email: z.email().optional(),
    unsubscribed: z.boolean().optional().describe("Filter by unsubscribed status (true/false)"),
  }),
  execute: async ({ event_id, email, unsubscribed, ...input }) => {
    try {
      const where = {
        ...(event_id !== undefined && { event: { equals: event_id } }),
        ...(email !== undefined && { email: { equals: email } }),
        ...(unsubscribed !== undefined && { unsubscribed: { equals: unsubscribed } }),
      };
      const res = await payload.find({
        collection: COLLECTION,
        ...paginationQuery(input),
        ...(Object.keys(where).length > 0 ? { where } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: (res.docs as PayloadRsvp[]).map(projectRsvp),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_rsvp = tool({
  description: "Fetch a single RSVP by ID.",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.findByID({ collection: COLLECTION, id })) as PayloadRsvp;
      return JSON.stringify(projectRsvp(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_rsvp = tool({
  description: "Create an RSVP for an event on behalf of a user.",
  inputSchema: z.object({
    event_id: z.union([z.string(), z.number()]),
    email: z.email(),
    name: z.string(),
    unsubscribed: z.boolean().optional(),
  }),
  execute: async ({ event_id, email, name, unsubscribed }) => {
    try {
      const doc = (await payload.create({
        collection: COLLECTION,
        data: {
          event: event_id,
          email,
          name,
          unsubscribed: unsubscribed ?? false,
        },
      })) as PayloadRsvp;
      return JSON.stringify(projectRsvp(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_rsvp = tool({
  description:
    "Update an RSVP. Commonly used to toggle `unsubscribed: true` when someone asks off the list.",
  inputSchema: z.object({
    id: z.union([z.string(), z.number()]),
    email: z.email().optional(),
    name: z.string().optional(),
    unsubscribed: z.boolean().optional(),
    event_id: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async ({ id, event_id, ...rest }) => {
    try {
      const data: Record<string, unknown> = { ...rest };
      if (event_id !== undefined) data.event = event_id;
      const doc = (await payload.update({
        collection: COLLECTION,
        id,
        data,
      })) as PayloadRsvp;
      return JSON.stringify(projectRsvp(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_rsvp = approval(
  tool({
    description:
      "Delete an RSVP permanently. Prefer `update_rsvp({ unsubscribed: true })` when the user just wants to opt out — deletion loses the audit trail.",
    inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
    execute: async ({ id }) => {
      try {
        const doc = (await payload.delete({ collection: COLLECTION, id })) as PayloadRsvp;
        return JSON.stringify({ deleted: true, id: doc.id ?? id });
      } catch (err) {
        throw wrapPayloadError(err);
      }
    },
  }),
);
