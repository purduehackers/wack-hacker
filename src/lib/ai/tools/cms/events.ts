import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { cmsAdminUrl, paginationQuery, payload, wrapPayloadError } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const COLLECTION = "events";

interface PayloadEvent {
  id?: number | string;
  name?: string;
  published?: boolean;
  eventType?: string;
  start?: string;
  end?: string;
  location_name?: string;
  location_url?: string;
  description?: unknown;
  send?: boolean;
  sentAt?: string;
  stats?: Array<{ data?: string; label?: string }>;
  createdAt?: string;
  updatedAt?: string;
}

function projectEvent(e: PayloadEvent) {
  return {
    id: e.id,
    name: e.name,
    published: e.published,
    event_type: e.eventType,
    start: e.start,
    end: e.end,
    location_name: e.location_name,
    location_url: e.location_url,
    send: e.send,
    sent_at: e.sentAt,
    stats: e.stats,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    href: e.id === undefined ? undefined : cmsAdminUrl(COLLECTION, e.id),
  };
}

/**
 * Wrap a plain-text description as minimal Lexical JSON, which is the format
 * Payload's richText field expects on writes. Users can pass plain prose and
 * the server will render it as a single paragraph.
 */
function richTextParagraph(text: string) {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: null,
      children: [
        {
          type: "paragraph",
          format: "",
          indent: 0,
          version: 1,
          direction: null,
          children: [
            { type: "text", text, format: 0, detail: 0, mode: "normal", style: "", version: 1 },
          ],
        },
      ],
    },
  };
}

export const list_events = tool({
  description:
    "List events from the CMS. Supports pagination and sort (prefix field with '-' for descending, e.g. '-start'). Includes published flag, start/end, location, and email-send status.",
  inputSchema: z.object({
    ...paginationInputShape,
    published_only: z
      .boolean()
      .optional()
      .describe("When true, return only events with published === true"),
  }),
  execute: async ({ published_only, ...input }) => {
    try {
      const res = await payload.find({
        collection: COLLECTION,
        ...paginationQuery(input),
        ...(published_only ? { where: { published: { equals: true } } } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: (res.docs as PayloadEvent[]).map(projectEvent),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_event = tool({
  description: "Fetch a single event by ID.",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]).describe("Event ID") }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.findByID({ collection: COLLECTION, id })) as PayloadEvent;
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_event = tool({
  description:
    "Create a new event. `description` accepts plain text and is wrapped as a single Lexical paragraph. Set `published: true` only when the event is ready to appear on the website.",
  inputSchema: z.object({
    name: z.string(),
    start: z.string().describe("ISO datetime for event start"),
    end: z.string().optional().describe("ISO datetime for event end"),
    event_type: z.string().optional().describe("Event type (default 'hack-night')"),
    location_name: z.string().optional(),
    location_url: z.string().optional(),
    description: z.string().describe("Plain text description"),
    published: z.boolean().optional(),
  }),
  execute: async ({ event_type, description, ...rest }) => {
    try {
      const data: Record<string, unknown> = {
        ...rest,
        eventType: event_type ?? "hack-night",
        description: richTextParagraph(description),
        published: rest.published ?? false,
      };
      const doc = (await payload.create({ collection: COLLECTION, data })) as PayloadEvent;
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_event = tool({
  description:
    "Update an event by ID. Only fields you pass are changed. `description` (if set) is wrapped as a single Lexical paragraph — omit it when you don't want to overwrite existing richText.",
  inputSchema: z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    event_type: z.string().optional(),
    location_name: z.string().optional(),
    location_url: z.string().optional(),
    description: z.string().optional(),
    published: z.boolean().optional(),
  }),
  execute: async ({ id, event_type, description, ...rest }) => {
    try {
      const data: Record<string, unknown> = { ...rest };
      if (event_type !== undefined) data.eventType = event_type;
      if (description !== undefined) data.description = richTextParagraph(description);
      const doc = (await payload.update({
        collection: COLLECTION,
        id,
        data,
      })) as PayloadEvent;
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_event = approval(
  tool({
    description: "Delete an event permanently. Also detaches RSVPs and sent-email records.",
    inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
    execute: async ({ id }) => {
      try {
        const doc = (await payload.delete({ collection: COLLECTION, id })) as PayloadEvent;
        return JSON.stringify({ deleted: true, id: doc.id ?? id });
      } catch (err) {
        throw wrapPayloadError(err);
      }
    },
  }),
);

export const publish_event = tool({
  description: "Mark an event as published (visible on the website).",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.update({
        collection: COLLECTION,
        id,
        data: { published: true },
      })) as PayloadEvent;
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const unpublish_event = tool({
  description: "Mark an event as unpublished (hidden from the website).",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.update({
        collection: COLLECTION,
        id,
        data: { published: false },
      })) as PayloadEvent;
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const send_blast = approval(
  tool({
    description:
      "Fire the email blast for this event to all active RSVPs (sets `send: true`). Payload's afterChange hook sends real emails via Resend and resets `send` to false afterwards. Destructive external side effect — use only after explicit confirmation.",
    inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
    execute: async ({ id }) => {
      try {
        const doc = (await payload.update({
          collection: COLLECTION,
          id,
          data: { send: true },
        })) as PayloadEvent;
        return JSON.stringify({ triggered: true, ...projectEvent(doc) });
      } catch (err) {
        throw wrapPayloadError(err);
      }
    },
  }),
);
