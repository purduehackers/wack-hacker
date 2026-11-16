import { z } from "zod";

import { saveDataset } from "../../../lib/artifacts/datasets.ts";
import { defineDomainTool } from "../../../lib/policy/domain-tools.ts";
import { executeBuffer } from "./client.ts";
import { paginateBuffer } from "./pagination.ts";
import { operationField } from "./schema.ts";

/** Each generated wrapper keeps the complete upstream argument schema. */
export function defineBufferOperation<S extends z.ZodRawShape>(
  name: string,
  argumentsSchema: z.ZodObject<S>,
) {
  const { field, kind } = operationField(name);
  const destructive = name.startsWith("delete");
  return defineDomainTool({
    description: `${field.description ?? name} Complete Buffer API operation. ${destructive ? "Destructive; admin only." : "Organizer only."} Use selection for additional GraphQL response fields.`,
    access: {
      risk: destructive ? "destructive" : kind === "query" ? "read" : "write",
      minRole: destructive ? "admin" : "organizer",
    },
    requires: ["BUFFER_API_KEY", "BUFFER_ORGANIZATION_IDS"],
    input: z.strictObject({
      arguments: argumentsSchema,
      selection: z
        .string()
        .min(1)
        .max(20_000)
        .optional()
        .describe(
          "Optional GraphQL selection inside this operation's result; no operation, aliases, or fragments outside it.",
        ),
      maxPages: z
        .int()
        .min(1)
        .max(10)
        .default(1)
        .describe("Bounded cursor pagination for list queries. Writes must use 1."),
      exportDataset: z
        .boolean()
        .default(false)
        .describe("Save the complete returned JSON for render_chart and return a dataset ID."),
    }),
    execute: async (input, ctx) => {
      if (kind === "mutation" && input.maxPages !== 1) throw new Error("Mutations cannot paginate");
      const variables = z.record(z.string(), z.json()).parse(input.arguments);
      const result = await paginateBuffer(variables, input.maxPages, (pageArgs) =>
        executeBuffer(
          name,
          pageArgs,
          input.selection,
          `${ctx.session.id}:${ctx.callId}`,
          ctx.abortSignal,
        ),
      );
      if (!input.exportDataset) return result;
      const dataset = await saveDataset(
        ctx,
        result,
        `Buffer ${name}`,
        result.complete && result.ok,
      );
      return { ...result, datasetId: dataset.id };
    },
  });
}
