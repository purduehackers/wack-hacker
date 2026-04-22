import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext } from "./utils.ts";

const KNOWN_PORTS = [3000, 5173, 4321, 8000] as const;

export const preview_url = tool({
  description: `Return the public URL for a dev-server port running inside the sandbox. Use this AFTER you start a detached server (e.g. \`bash\` with a dev command) so you can share the URL with the user.

Only ports declared at sandbox creation time route publicly. The coding sandbox exposes ${KNOWN_PORTS.join(
    ", ",
  )} by default — start your server on one of those.`,
  inputSchema: z.object({
    port: z
      .number()
      .int()
      .min(1)
      .max(65_535)
      .describe("Port the dev server is listening on. One of the preconfigured preview ports."),
  }),
  execute: async ({ port }, { experimental_context }) => {
    const { sandbox } = getSandboxContext(experimental_context, "preview_url");
    try {
      const url = sandbox.domain(port);
      return JSON.stringify({ port, url });
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        port,
        hint: `Port ${port} isn't routed. Use one of ${KNOWN_PORTS.join(", ")}.`,
      });
    }
  },
});
