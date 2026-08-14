import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

/**
 * The decoding layer for GitHub Projects v2.
 *
 * Projects v2 has no REST surface, so every project tool goes through Octokit's
 * `graphql()`, which returns an untyped payload. This module decodes each
 * response against a schema rather than reading it field-by-field at the call
 * site. A schema change upstream then fails once, loudly, with the path that
 * broke.
 */

const pageInfoSchema = z.strictObject({
  hasNextPage: z.boolean(),
  endCursor: z.string(),
});

/** The fields every ProjectV2 selection asks for. The detail query adds to them. */
const projectSummaryShape = {
  id: z.string(),
  title: z.string(),
  number: z.int(),
  url: z.url(),
  closed: z.boolean(),
  shortDescription: z.string(),
};

const projectFieldSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  dataType: z.string(),
});

export const listOrgProjectsResponseSchema = z.strictObject({
  organization: z.strictObject({
    projectsV2: z.strictObject({
      nodes: z.array(z.strictObject(projectSummaryShape)),
      pageInfo: pageInfoSchema,
    }),
  }),
});

export const getProjectResponseSchema = z.strictObject({
  organization: z.strictObject({
    projectV2: z.strictObject({
      ...projectSummaryShape,
      readme: z.string(),
      fields: z.strictObject({ nodes: z.array(projectFieldSchema) }),
    }),
  }),
});

export const listProjectItemsResponseSchema = z.strictObject({
  organization: z.strictObject({
    projectV2: z.strictObject({
      items: z.strictObject({
        nodes: z.array(
          z.strictObject({
            id: z.string(),
            type: z.string(),
            content: z
              .strictObject({
                __typename: z.string(),
                title: z.string().optional(),
                number: z.int().optional(),
                url: z.url().optional(),
              })
              .nullable(),
            fieldValues: z.strictObject({
              nodes: z.array(
                z.strictObject({
                  field: z.strictObject({ name: z.string() }).optional(),
                  text: z.string().optional(),
                  name: z.string().optional(),
                  date: z.string().optional(),
                  number: z.number().optional(),
                }),
              ),
            }),
          }),
        ),
        pageInfo: pageInfoSchema,
      }),
    }),
  }),
});

export const createProjectItemResponseSchema = z.strictObject({
  addProjectV2ItemById: z.strictObject({ item: z.strictObject({ id: z.string() }) }),
});

/** Projects v2 is GraphQL-only, so every call decodes an untyped payload here. */
export function decodeGraphql<S extends z.ZodType>(schema: S, payload: unknown): z.output<S> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new UpstreamError({
      service: "GitHub",
      status: 502,
      detail: `invalid GraphQL response: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}
