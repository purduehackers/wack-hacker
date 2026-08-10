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

const COLLECTION = "shelter-projects";

type PayloadShelterProject = PayloadDocument<"shelter-projects">;

/** Writable shelter-project fields. Create requires them; update takes the partial. */
const shelterProjectFields = {
  name: z.string(),
  last_division: z.string(),
  last_owner: z.string(),
  description: z.string(),
  image_id: documentId,
  visible: z.boolean().optional(),
};

function projectShelter(s: PayloadShelterProject) {
  const image = relationship(s.image);
  return {
    id: s.id,
    visible: s.visible,
    name: s.name,
    last_division: s.last_division,
    last_owner: s.last_owner,
    description: s.description,
    image_id: image.id,
    image_url: image.url,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    href: s.id === undefined ? undefined : cmsAdminUrl(COLLECTION, s.id),
  };
}

export const list_shelter_projects = defineTool({
  description:
    "List shelter wall project showcase entries. Each has name, last_division, last_owner, description, and a `visible` flag (true = shown publicly).",
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
        docs: res.docs.map(projectShelter),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_shelter_project = defineTool({
  description: "Fetch a single shelter project by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({
        collection: COLLECTION,
        id,
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_shelter_project = defineTool({
  description:
    "Create a new shelter project. `image_id` must point at an existing media asset (upload via `upload_media` first). Defaults to visible: false — flip with `publish_shelter_project` when ready.",
  access: { risk: "write" },
  input: z.strictObject(shelterProjectFields),
  execute: async ({ image_id, visible, ...rest }) => {
    try {
      const doc = await payload.create({
        collection: COLLECTION,
        data: { ...rest, image: image_id, visible: visible ?? false },
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_shelter_project = defineTool({
  description: "Update a shelter project. Only fields you pass are changed.",
  access: { risk: "write" },
  input: z.strictObject({
    id: documentId,
    ...z.object(shelterProjectFields).partial().shape,
  }),
  execute: async ({ id, image_id, ...rest }) => {
    try {
      const data = {
        ...rest,
        ...(image_id !== undefined && { image: image_id }),
      };
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data,
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_shelter_project = defineTool({
  description: "Delete a shelter project permanently.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
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

export const publish_shelter_project = defineTool({
  description: "Make a shelter project visible on the public showcase (visible: true).",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data: { visible: true },
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const unpublish_shelter_project = defineTool({
  description: "Hide a shelter project from the public showcase (visible: false).",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data: { visible: false },
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
