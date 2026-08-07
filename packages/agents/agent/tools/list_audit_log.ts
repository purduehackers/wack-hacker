import { defineDynamic, defineTool } from "eve/tools";

import { auditLogInputSchema, queryAuditLog } from "../lib/core/audit-log.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/core/runtime.ts";
import { guardToolExecution } from "../lib/core/serialization.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("list_audit_log", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Read the durable action audit log: policy-gated tool executions, approval requests, and who approved or denied them. Rows are returned newest first. Use this to answer questions like 'who deleted X' or 'what destructive actions ran yesterday'.",
        inputSchema: auditLogInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("list_audit_log", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              return await queryAuditLog(input);
            } catch (cause) {
              return coreToolFailure("Turso", cause);
            }
          });
        },
      });
    },
  },
});
