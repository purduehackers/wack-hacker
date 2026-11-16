import { defineDynamic, defineTool } from "eve/tools";

import { createChart } from "../lib/charts/service.ts";
import { chartInputSchema } from "../lib/charts/spec.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/policy/core-tools.ts";
import { redactProviderText } from "../lib/policy/provider-redaction.ts";
import { guardToolExecution } from "../lib/serialization.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("render_chart", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Create a polished data chart with a PNG displayed in the Discord reply and SVG/CSV attachments. Works with any supplied table or authorized provider dataset. Reuse chartId for revisions. Preserve missing values and distinguish publication cohorts from observed changes. Supply accurate source, period and alt text.",
        inputSchema: chartInputSchema,
        execute: async (input, toolCtx) =>
          guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("render_chart", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              return await createChart(input, toolCtx);
            } catch (cause) {
              return {
                ...coreToolFailure("Chart renderer", cause),
                reason:
                  cause instanceof Error
                    ? redactProviderText(cause.message).slice(0, 1000)
                    : "Chart rendering failed",
              };
            }
          }),
      });
    },
  },
});
