import {
  buildClientSchema,
  findBreakingChanges,
  findDangerousChanges,
  getIntrospectionQuery,
  printSchema,
} from "graphql";
import type { IntrospectionQuery } from "graphql";
import { z } from "zod";

import * as inputs from "../agent/subagents/buffer/lib/inputs.ts";
import { BUFFER_MANIFEST } from "../agent/subagents/buffer/lib/manifest.ts";
import { BUFFER_TOOLS } from "../agent/subagents/buffer/lib/registry.ts";
import { bufferSchema } from "../agent/subagents/buffer/lib/schema.ts";
import { bufferManifest, renderBufferInputs } from "./lib/buffer-schema.ts";

const root = new URL("../agent/subagents/buffer/lib/", import.meta.url);
if (process.argv.includes("--refresh")) {
  const key = process.env.BUFFER_API_KEY;
  if (!key) throw new Error("BUFFER_API_KEY is required for live schema refresh");
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Schema request failed: ${response.status}`);
  // GraphQL's own builder validates the introspection structure.
  const payload = z
    .object({
      data: z.custom<IntrospectionQuery>(
        (value) =>
          z.object({ __schema: z.object({ types: z.array(z.unknown()) }) }).safeParse(value)
            .success,
      ),
    })
    .parse(await response.json());
  const next = buildClientSchema(payload.data);
  console.info(
    JSON.stringify(
      {
        breaking: findBreakingChanges(bufferSchema, next),
        dangerous: findDangerousChanges(bufferSchema, next),
        operations: bufferManifest(next),
      },
      undefined,
      2,
    ),
  );
  await Bun.write(
    new URL("schema-source.ts", root),
    `// Public Buffer schema, refreshed ${new Date().toISOString().slice(0, 10)}.\nexport const BUFFER_SCHEMA_SDL = ${JSON.stringify(printSchema(next))};\n`,
  );
  await Bun.write(new URL("inputs.ts", root), renderBufferInputs(next));
  await Bun.write(
    new URL("manifest.ts", root),
    `// Reviewed public operations and their Wack Hacker policy.\nexport const BUFFER_MANIFEST = ${JSON.stringify(bufferManifest(next), undefined, 2)} as const;\n`,
  );
  console.info(
    "Schema and inputs refreshed. Review changes, register any new operations, format, and run buffer:schema again.",
  );
} else {
  const manifest = bufferManifest(bufferSchema);
  const tools = z
    .record(
      z.string(),
      z.looseObject({ access: z.object({ risk: z.string(), minRole: z.string() }) }),
    )
    .parse(BUFFER_TOOLS);
  for (const operation of manifest) {
    const tool = tools[operation.tool];
    if (!tool || tool.access.risk !== operation.risk || tool.access.minRole !== operation.minRole)
      throw new Error(`Missing or incorrect policy for ${operation.operation}`);
  }
  const generatedPath = new URL(".buffer-inputs-check.ts", import.meta.url);
  try {
    await Bun.write(generatedPath, renderBufferInputs(bufferSchema));
    const generated = z
      .record(z.string(), z.instanceof(z.ZodType))
      .parse(await import(generatedPath.href));
    const committed = z.record(z.string(), z.instanceof(z.ZodType)).parse(inputs);
    if (Object.keys(generated).length !== Object.keys(committed).length)
      throw new Error("Input schema export coverage changed");
    for (const [name, schema] of Object.entries(generated)) {
      const actual = committed[name];
      if (
        !actual ||
        JSON.stringify(z.toJSONSchema(actual)) !== JSON.stringify(z.toJSONSchema(schema))
      )
        throw new Error(`Input schema drift: ${name}`);
    }
  } finally {
    await Bun.file(generatedPath).delete();
  }
  if (JSON.stringify(BUFFER_MANIFEST) !== JSON.stringify(manifest))
    throw new Error("Manifest does not match reviewed schema");
  console.info(
    `Buffer: ${manifest.length} public operations and all input fields covered; policies match.`,
  );
}
