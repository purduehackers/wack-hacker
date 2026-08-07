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
import { richTextParagraph } from "./richtext.ts";

const COLLECTION = "hack-night-sessions";

type PayloadHackNightSession = PayloadDocument<"hack-night-sessions">;

function projectSession(s: PayloadHackNightSession) {
  return {
    id: s.id,
    title: s.title,
    date: s.date,
    published: s.published,
    host: s.host,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    href: s.id === undefined ? undefined : cmsAdminUrl(COLLECTION, s.id),
  };
}

export const list_hack_night_sessions = defineTool({
  name: "list_hack_night_sessions",
  domain: "cms",
  description:
    "List hack night session records. Each has a title, date, host {preferred_name, discord_id}, and published flag.",
  access: { risk: "read" },
  input: z.object({
    ...paginationInputShape,
    published_only: z.boolean().optional(),
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
        docs: res.docs.map(projectSession),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_hack_night_session = defineTool({
  name: "get_hack_night_session",
  domain: "cms",
  description: "Fetch a single hack night session by ID.",
  access: { risk: "read" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({
        collection: COLLECTION,
        id,
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_hack_night_session = defineTool({
  name: "create_hack_night_session",
  domain: "cms",
  description:
    "Create a new hack night session entry. Pass host as { preferred_name, discord_id }.",
  access: { risk: "write" },
  input: z.object({
    title: z.string(),
    date: z.string().describe("ISO datetime"),
    host_preferred_name: z.string(),
    host_discord_id: z.string(),
    description: z.string(),
    published: z.boolean().optional(),
  }),
  execute: async ({
    title,
    date,
    host_preferred_name,
    host_discord_id,
    description,
    published,
  }) => {
    try {
      const doc = await payload.create({
        collection: COLLECTION,
        data: {
          title,
          date,
          host: { preferred_name: host_preferred_name, discord_id: host_discord_id },
          description: richTextParagraph(description),
          published: published ?? false,
        },
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_hack_night_session = defineTool({
  name: "update_hack_night_session",
  domain: "cms",
  description:
    "Update a hack night session. Only fields you pass are changed. If updating host, pass both host_preferred_name and host_discord_id (Payload treats the host group as a replace-on-write object; a partial patch would clobber the other subfield). Description (if provided) is wrapped as a single Lexical paragraph.",
  access: { risk: "write" },
  input: z
    .object({
      id: z.union([z.string(), z.number()]),
      title: z.string().optional(),
      date: z.string().optional(),
      host_preferred_name: z.string().optional(),
      host_discord_id: z.string().optional(),
      description: z.string().optional(),
      published: z.boolean().optional(),
    })
    .refine(
      ({ host_preferred_name, host_discord_id }) =>
        (host_preferred_name === undefined) === (host_discord_id === undefined),
      {
        message:
          "host_preferred_name and host_discord_id must be provided together when updating host.",
        path: ["host_preferred_name"],
      },
    ),
  execute: async ({ id, host_preferred_name, host_discord_id, description, ...rest }) => {
    try {
      const data: Record<string, unknown> = { ...rest };
      if (host_preferred_name !== undefined && host_discord_id !== undefined) {
        data.host = { preferred_name: host_preferred_name, discord_id: host_discord_id };
      }
      if (description !== undefined) data.description = richTextParagraph(description);
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data,
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_hack_night_session = defineTool({
  name: "delete_hack_night_session",
  domain: "cms",
  description: "Delete a hack night session record permanently.",
  access: { risk: "destructive" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.delete({
        collection: COLLECTION,
        id,
      });
      return JSON.stringify({ deleted: true, id: doc.id ?? id });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const publish_hack_night_session = defineTool({
  name: "publish_hack_night_session",
  domain: "cms",
  description: "Publish a hack night session (makes it visible on the hack night dashboard).",
  access: { risk: "destructive" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data: { published: true },
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const unpublish_hack_night_session = defineTool({
  name: "unpublish_hack_night_session",
  domain: "cms",
  description: "Unpublish a hack night session.",
  access: { risk: "destructive" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data: { published: false },
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
