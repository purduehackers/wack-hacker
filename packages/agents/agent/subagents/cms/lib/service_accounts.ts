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

const COLLECTION = "service-accounts";

/** Roles defined in purduehackers/cms src/collections/auth-utils.ts. */
const SERVICE_ACCOUNT_ROLES = [
  "admin",
  "editor",
  "viewer",
  "hack_night_dashboard",
  "events_website",
  "wack_hacker",
] as const;

type PayloadServiceAccount = PayloadDocument<"service-accounts">;

function projectServiceAccount(s: PayloadServiceAccount) {
  return {
    id: s.id,
    name: s.name,
    revoked: s.revoked,
    roles: s.roles,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    href: s.id === undefined ? undefined : cmsAdminUrl(COLLECTION, s.id),
  };
}

export const list_service_accounts = defineTool({
  name: "list_service_accounts",
  domain: "cms",
  description:
    "List service accounts (API-key-only CMS identities used by bots and integrations). Each has a name, revoked flag, and role set.",
  access: { risk: "read" },
  input: z.object({
    ...paginationInputShape,
    revoked_only: z
      .boolean()
      .optional()
      .describe("When true, return only revoked service accounts"),
  }),
  execute: async ({ revoked_only, ...input }) => {
    try {
      const res = await payload.find({
        collection: COLLECTION,
        ...paginationQuery(input),
        ...(revoked_only ? { where: { revoked: { equals: true } } } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectServiceAccount),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_service_account = defineTool({
  name: "get_service_account",
  domain: "cms",
  description: "Fetch a single service account by ID.",
  access: { risk: "read" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({
        collection: COLLECTION,
        id,
      });
      return JSON.stringify(projectServiceAccount(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_service_account = defineTool({
  name: "create_service_account",
  domain: "cms",
  description:
    "Create a new service account. The API key itself is minted in the Payload admin UI after creation — this tool only provisions the identity and its roles.",
  access: { risk: "destructive" },
  input: z.object({
    name: z.string(),
    roles: z.array(z.enum(SERVICE_ACCOUNT_ROLES)).min(1),
    revoked: z.boolean().optional(),
  }),
  execute: async ({ name, roles, revoked }) => {
    try {
      const doc = await payload.create({
        collection: COLLECTION,
        data: { name, roles, revoked: revoked ?? false },
      });
      return JSON.stringify(projectServiceAccount(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_service_account = defineTool({
  name: "update_service_account",
  domain: "cms",
  description:
    "Update a service account. Set `revoked: true` to kill its API key without deleting the record (preserves audit trail).",
  access: { risk: "destructive" },
  input: z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    roles: z.array(z.enum(SERVICE_ACCOUNT_ROLES)).min(1).optional(),
    revoked: z.boolean().optional(),
  }),
  execute: async ({ id, ...rest }) => {
    try {
      const data: Record<string, unknown> = {};
      if (rest.name !== undefined) data.name = rest.name;
      if (rest.roles !== undefined) data.roles = rest.roles;
      if (rest.revoked !== undefined) data.revoked = rest.revoked;
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data,
      });
      return JSON.stringify(projectServiceAccount(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_service_account = defineTool({
  name: "delete_service_account",
  domain: "cms",
  description:
    "Delete a service account permanently. Prefer `update_service_account({ revoked: true })` unless you're sure you don't need the audit trail.",
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
