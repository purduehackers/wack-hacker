import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type catalogDefinition from "../../../agent/tools/integrations.ts";
import { transformDynamicToolExecute } from "../../../node_modules/eve/dist/src/internal/workflow-bundle/dynamic-tool-transform.js";

/** Apply Eve's actual authored transform, keeping imports on their original modules. */
export async function compiledCatalog() {
  const sourcePath = resolve(import.meta.dir, "../../../agent/tools/integrations.ts");
  const source = await Bun.file(sourcePath).text();
  const transformed = await transformDynamicToolExecute(sourcePath, source);
  if (transformed === null) throw new Error("Eve did not transform the catalog");
  const directory = resolve(import.meta.dir, "../../../.eve/catalog-test");
  const outputPath = join(directory, `${crypto.randomUUID()}.ts`);
  const relocated = transformed.code.replaceAll(
    /from\s+(['"])(\.\.?\/[^'"]+)\1/gu,
    (_match, _quote: string, relative: string) =>
      `from ${JSON.stringify(resolve(dirname(sourcePath), relative))}`,
  );
  await Bun.write(outputPath, relocated);
  try {
    const compiled: { readonly default: typeof catalogDefinition } = await import(outputPath);
    return compiled.default;
  } finally {
    await rm(outputPath);
  }
}
