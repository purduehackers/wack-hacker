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

const COLLECTION = "ugrants";

type PayloadUgrant = PayloadDocument<"ugrants">;

/** Writable ugrant fields. Create requires them; update takes the partial. */
const ugrantFields = {
  name: z.string(),
  author: z.string(),
  description: z.string(),
  image_id: documentId,
  author_url: z.url().optional(),
  project_url: z.url().optional(),
  visible: z.boolean().optional(),
};

function projectUgrant(u: PayloadUgrant) {
  const image = relationship(u.image);
  return {
    id: u.id,
    visible: u.visible,
    name: u.name,
    author: u.author,
    description: u.description,
    image_id: image.id,
    image_url: image.url,
    author_url: u.authorUrl,
    project_url: u.projectUrl,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
    href: u.id === undefined ? undefined : cmsAdminUrl(COLLECTION, u.id),
  };
}

export const list_ugrants = defineTool({
  description:
    'List microgrant ("ugrant") showcase entries. Each has name, author, description, project/author URLs, and a `visible` flag (true = shown publicly).',
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    visible_only: z.boolean().optional(),
  }),
  execute: async ({ visible_only, ...input }) => {
    try {
      const res = await payload.find({
        collection: COLLECTION,
        ...paginationQuery(input),
        ...(visible_only ? { where: { visible: { equals: true } } } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectUgrant),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_ugrant = defineTool({
  description: "Fetch a single ugrant by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({ collection: COLLECTION, id });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_ugrant = defineTool({
  description:
    "Create a new ugrant showcase entry. `image_id` must point at an existing media asset (upload via `upload_media` first). Defaults to visible: false — flip with `publish_ugrant` when ready.",
  access: { risk: "write" },
  input: z.strictObject(ugrantFields),
  execute: async ({ image_id, author_url, project_url, visible, ...rest }) => {
    try {
      const doc = await payload.create({
        collection: COLLECTION,
        data: {
          ...rest,
          image: image_id,
          ...(author_url !== undefined && { authorUrl: author_url }),
          ...(project_url !== undefined && { projectUrl: project_url }),
          visible: visible ?? false,
        },
      });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_ugrant = defineTool({
  description: "Update a ugrant. Only fields you pass are changed.",
  access: { risk: "write" },
  input: z.strictObject({ id: documentId, ...z.object(ugrantFields).partial().shape }),
  execute: async ({ id, image_id, author_url, project_url, ...rest }) => {
    try {
      const data = {
        ...rest,
        ...(image_id !== undefined && { image: image_id }),
        ...(author_url !== undefined && { authorUrl: author_url }),
        ...(project_url !== undefined && { projectUrl: project_url }),
      };
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data,
      });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_ugrant = defineTool({
  description: "Delete a ugrant permanently.",
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

export const publish_ugrant = defineTool({
  description: "Make a ugrant visible on the public showcase (visible: true).",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data: { visible: true },
      });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const unpublish_ugrant = defineTool({
  description: "Hide a ugrant from the public showcase (visible: false).",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data: { visible: false },
      });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
