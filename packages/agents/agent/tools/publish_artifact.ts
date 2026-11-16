import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { attachmentUrlSchema, importAttachment } from "../lib/artifacts/import-media.ts";
import { artifactIdSchema, artifactScope, publishArtifact } from "../lib/artifacts/store.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/policy/core-tools.ts";
import { guardToolExecution } from "../lib/serialization.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("publish_artifact", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Make a selected artifact or attached Discord image/video/document publicly accessible at a stable URL for Buffer media. Only use when the user requests public sharing or use in a social post. Files up to 8 MB; larger files need an existing stable public URL. Published files remain pinned.",
        inputSchema: z.union([
          z.strictObject({ artifactId: artifactIdSchema }),
          z.strictObject({ attachmentUrl: attachmentUrlSchema }),
        ]),
        execute: async (input, toolCtx) =>
          guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("publish_artifact", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              const scope = artifactScope(toolCtx);
              const id =
                "artifactId" in input
                  ? input.artifactId
                  : (
                      await importAttachment(
                        input.attachmentUrl,
                        scope,
                        toolCtx.callId,
                        toolCtx.abortSignal,
                      )
                    ).id;
              return { ok: true, ...(await publishArtifact(id, scope)) };
            } catch (cause) {
              return coreToolFailure("Artifact publication", cause);
            }
          }),
      });
    },
  },
});
