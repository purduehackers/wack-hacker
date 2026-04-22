import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { cmsAdminUrl, paginationQuery, payload, wrapPayloadError } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const COLLECTION = "shelter-projects";

interface PayloadShelterProject {
  id?: number | string;
  visible?: boolean;
  name?: string;
  last_division?: string;
  last_owner?: string;
  description?: string;
  image?: number | string | { id?: number | string; url?: string };
  createdAt?: string;
  updatedAt?: string;
}

function imageIdOf(image: PayloadShelterProject["image"]): number | string | undefined {
  if (typeof image === "object" && image !== null) return image.id;
  return image;
}

function projectShelter(s: PayloadShelterProject) {
  return {
    id: s.id,
    visible: s.visible,
    name: s.name,
    last_division: s.last_division,
    last_owner: s.last_owner,
    description: s.description,
    image_id: imageIdOf(s.image),
    image_url: typeof s.image === "object" && s.image !== null ? s.image.url : undefined,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    href: s.id === undefined ? undefined : cmsAdminUrl(COLLECTION, s.id),
  };
}

export const list_shelter_projects = tool({
  description:
    "List shelter wall project showcase entries. Each has name, last_division, last_owner, description, and a `visible` flag (true = shown publicly).",
  inputSchema: z.object({
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
        docs: (res.docs as PayloadShelterProject[]).map(projectShelter),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_shelter_project = tool({
  description: "Fetch a single shelter project by ID.",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.findByID({
        collection: COLLECTION,
        id,
      })) as PayloadShelterProject;
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_shelter_project = tool({
  description:
    "Create a new shelter project. `image_id` must point at an existing media asset (upload via `upload_media` first). Defaults to visible: false — flip with `publish_shelter_project` when ready.",
  inputSchema: z.object({
    name: z.string(),
    last_division: z.string(),
    last_owner: z.string(),
    description: z.string(),
    image_id: z.union([z.string(), z.number()]),
    visible: z.boolean().optional(),
  }),
  execute: async ({ image_id, visible, ...rest }) => {
    try {
      const doc = (await payload.create({
        collection: COLLECTION,
        data: { ...rest, image: image_id, visible: visible ?? false },
      })) as PayloadShelterProject;
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_shelter_project = tool({
  description: "Update a shelter project. Only fields you pass are changed.",
  inputSchema: z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    last_division: z.string().optional(),
    last_owner: z.string().optional(),
    description: z.string().optional(),
    image_id: z.union([z.string(), z.number()]).optional(),
    visible: z.boolean().optional(),
  }),
  execute: async ({ id, image_id, ...rest }) => {
    try {
      const data: Record<string, unknown> = { ...rest };
      if (image_id !== undefined) data.image = image_id;
      const doc = (await payload.update({
        collection: COLLECTION,
        id,
        data,
      })) as PayloadShelterProject;
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_shelter_project = approval(
  tool({
    description: "Delete a shelter project permanently.",
    inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
    execute: async ({ id }) => {
      try {
        const doc = (await payload.delete({
          collection: COLLECTION,
          id,
        })) as PayloadShelterProject;
        return JSON.stringify({ deleted: true, id: doc.id ?? id });
      } catch (err) {
        throw wrapPayloadError(err);
      }
    },
  }),
);

export const publish_shelter_project = tool({
  description: "Make a shelter project visible on the public showcase (visible: true).",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.update({
        collection: COLLECTION,
        id,
        data: { visible: true },
      })) as PayloadShelterProject;
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const unpublish_shelter_project = tool({
  description: "Hide a shelter project from the public showcase (visible: false).",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.update({
        collection: COLLECTION,
        id,
        data: { visible: false },
      })) as PayloadShelterProject;
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
