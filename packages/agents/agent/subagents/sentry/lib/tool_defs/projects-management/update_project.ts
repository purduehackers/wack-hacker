import { updateAProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

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
      ...(input.name !== undefined && { name: input.name }),
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.platform !== undefined && { platform: input.platform }),
      ...(input.default_environment !== undefined && {
        default_environment: input.default_environment,
      }),
      ...(input.resolve_age !== undefined && { resolve_age: input.resolve_age }),
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
