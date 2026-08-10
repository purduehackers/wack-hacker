import {
  createANewProject,
  updateAProject,
  deleteAProject,
  listAProject_sEnvironments,
  listAProject_sClientKeys,
  createANewClientKey,
  deleteAClientKey,
  unwrapResult,
} from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

export const create_project = defineTool({
  description:
    "Create a new Sentry project under a team. Platform is the language/framework slug (e.g. 'javascript-nextjs', 'python-django', 'go'). Returns the new project's id, slug, and first DSN.",
  access: { risk: "write", minRole: "admin" },
  input: z.strictObject({
    team_slug: z.string().describe("Team slug that will own the project"),
    name: z.string().describe("Project name"),
    slug: z.string().optional().describe("Project slug (auto-generated from name if omitted)"),
    platform: z.string().optional().describe("Platform identifier (e.g. 'javascript-nextjs')"),
  }),
  execute: async ({ team_slug, name, slug, platform }) => {
    const result = await createANewProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
      body: {
        name,
        ...(slug === undefined ? {} : { slug }),
        ...(platform === undefined ? {} : { platform }),
      },
    });
    const { data } = unwrapResult(result, "createProject");
    return JSON.stringify(data);
  },
});

export const update_project = defineTool({
  description:
    "Update a Sentry project's name, slug, platform, default environment, or resolve age settings.",
  access: { risk: "write" },
  input: z.strictObject({
    project_slug: z.string().describe("Current project slug"),
    name: z.string().optional(),
    slug: z.string().optional(),
    platform: z.string().optional(),
    default_environment: z.string().optional(),
    resolve_age: z
      .int()
      .min(0)
      .optional()
      .describe("Hours after which unhandled issues auto-resolve (0 to disable)"),
  }),
  execute: async ({ project_slug, ...input }) => {
    const body = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      ...(input.default_environment === undefined
        ? {}
        : { default_environment: input.default_environment }),
      ...(input.resolve_age === undefined ? {} : { resolve_age: input.resolve_age }),
    };
    const result = await updateAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
      body,
    });
    const { data } = unwrapResult(result, "updateProject");
    return JSON.stringify(data);
  },
});

export const delete_project = defineTool({
  description:
    "Permanently delete a Sentry project. This removes all issues, events, and configuration. Irreversible.",
  access: { risk: "destructive", minRole: "admin", confirm: "second-party" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const result = await deleteAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    unwrapResult(result, "deleteProject");
    return JSON.stringify({ deleted: true, project_slug });
  },
});

export const list_project_environments = defineTool({
  description:
    "List environments configured for a Sentry project. Returns name, is_hidden, and environment ID.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const result = await listAProject_sEnvironments({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    const { data } = unwrapResult(result, "listEnvironments");
    return JSON.stringify(data);
  },
});

export const list_project_keys = defineTool({
  description:
    "List client keys (DSNs) for a Sentry project. Each key has a public DSN used by SDKs to send events.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const result = await listAProject_sClientKeys({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    const { data } = unwrapResult(result, "listKeys");
    return JSON.stringify(
      data.map((k) => ({
        id: k.id,
        label: k.label,
        isActive: k.isActive,
        public: k.dsn?.public,
        dateCreated: k.dateCreated,
      })),
    );
  },
});

export const create_project_key = defineTool({
  description: "Create a new client key (DSN) for a Sentry project. Returns the new DSN.",
  access: { risk: "write" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    name: z.string().describe("Human-readable label for the key"),
  }),
  execute: async ({ project_slug, name }) => {
    const result = await createANewClientKey({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
      body: { name },
    });
    const { data } = unwrapResult(result, "createKey");
    return JSON.stringify(data);
  },
});

export const delete_project_key = defineTool({
  description:
    "Delete a Sentry client key (DSN). All SDKs using this key will stop sending events. Irreversible.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    key_id: z.string().describe("Client key ID"),
  }),
  execute: async ({ project_slug, key_id }) => {
    const result = await deleteAClientKey({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        key_id,
      },
    });
    unwrapResult(result, "deleteKey");
    return JSON.stringify({ deleted: true, key_id });
  },
});
