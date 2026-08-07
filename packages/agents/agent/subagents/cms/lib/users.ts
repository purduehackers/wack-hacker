import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import {
  cmsAdminUrl,
  paginationQuery,
  payload,
  type PayloadDocument,
  wrapPayloadError,
} from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const COLLECTION = "users";

/** Roles defined in purduehackers/cms src/collections/auth-utils.ts. */
const USER_ROLES = [
  "admin",
  "editor",
  "viewer",
  "hack_night_dashboard",
  "events_website",
  "wack_hacker",
] as const;

type PayloadUser = PayloadDocument<"users">;

function projectUser(u: PayloadUser) {
  return {
    id: u.id,
    email: u.email,
    roles: u.roles,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
    href: u.id === undefined ? undefined : cmsAdminUrl(COLLECTION, u.id),
  };
}

export const list_users = defineTool({
  description:
    "List CMS user accounts (email + assigned roles). The `users` collection holds every human account regardless of role; filter by `email` to find one. Roles follow a hierarchy: admin > editor > viewer. Additional scoped roles: hack_night_dashboard, events_website, wack_hacker.",
  access: { risk: "read", minRole: "admin" },
  input: z.object({
    ...paginationInputShape,
    email: z.email().optional().describe("Filter by exact email address"),
  }),
  execute: async ({ email, ...input }) => {
    try {
      const res = await payload.find({
        collection: COLLECTION,
        ...paginationQuery(input),
        ...(email !== undefined ? { where: { email: { equals: email } } } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectUser),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_user = defineTool({
  description: "Fetch a single CMS user by ID.",
  access: { risk: "read", minRole: "admin" },
  input: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({
        collection: COLLECTION,
        id,
      });
      return JSON.stringify(projectUser(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const create_user = defineTool({
  description:
    "Invite a new CMS user. Assigns the given roles. Role hierarchy is enforced server-side (admin implies editor implies viewer).",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    email: z.email(),
    password: z.string().min(8).describe("Initial password (user can change it after login)"),
    roles: z.array(z.enum(USER_ROLES)).min(1),
  }),
  execute: async ({ email, password, roles }) => {
    try {
      const doc = await payload.create({
        collection: COLLECTION,
        data: { email, password, roles },
      });
      return JSON.stringify(projectUser(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const update_user = defineTool({
  description:
    "Update a CMS user's email or roles. Pass `roles` to replace the user's role set entirely (not a merge).",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    id: z.union([z.string(), z.number()]),
    email: z.email().optional(),
    roles: z.array(z.enum(USER_ROLES)).min(1).optional(),
  }),
  execute: async ({ id, email, roles }) => {
    try {
      const data: Record<string, unknown> = {};
      if (email !== undefined) data.email = email;
      if (roles !== undefined) data.roles = roles;
      const doc = await payload.update({
        collection: COLLECTION,
        id,
        data,
      });
      return JSON.stringify(projectUser(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_user = defineTool({
  description:
    "Remove a CMS user permanently. Loses their sessions and audit trail — prefer updating roles to strip access when possible.",
  access: { risk: "destructive", minRole: "admin" },
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
