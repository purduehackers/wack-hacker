import { defineWorkflowTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { z } from "zod";

import { env } from "../../env.ts";
import { executeWriteFile } from "./executeWriteFile.ts";

const durableWriteFile = defineWorkflowTool({
  description:
    "Replace a complete UTF-8 file in the durable workspace. Call workspace_open once before first use. Read the file and obtain its hash with bash sha256sum before replacing it. Pass that hash as expectedSha256, or missing only when creating a new file. A mismatch refuses the write. Workflow replay returns the original receipt without overwriting subsequent edits.",
  inputSchema: z.strictObject({
    filePath: z.string().max(1024),
    content: z.string().max(3 * 1024 * 1024),
    expectedSha256: z.union([z.literal("missing"), z.string().regex(/^[a-f0-9]{64}$/u)]),
  }),
  execute: executeWriteFile,
});

export default env.DURABLE_BASH_ENABLED ? durableWriteFile : writeFile;
