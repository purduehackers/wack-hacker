import { runInNewContext } from "node:vm";

import { z } from "zod";

const compiledToolSchema = z.object({
  name: z.string(),
  behavior: z.object({
    handling: z.object({
      kind: z.literal("workflow-tool"),
      entryPoint: z.literal("execute"),
      workflowId: z.string(),
    }),
  }),
});

/** Inspect the emitted artifact, not the authored definitions before transforms. */
export function sandboxWorkflowArtifact(source: string) {
  const manifest = /const manifest = (\{[\s\S]*?\n\});/u.exec(source)?.[1];
  if (manifest === undefined) throw new Error("Compiled Eve manifest is missing");
  // Rolldown emits JS numeric literals, so the manifest is not always JSON.
  // This is the locally built literal in an empty VM, with no host capabilities.
  const tree = z.json().parse(runInNewContext(`(${manifest})`, {}, { timeout: 1000 }));
  const workflows: { name: string; workflowId: string }[] = [];
  let slots = 0;
  let openers = 0;
  const visit = (value: z.output<ReturnType<typeof z.json>>): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = z.record(z.string(), z.json()).safeParse(value);
    if (!record.success) return;
    if (Array.isArray(record.data["tools"])) {
      for (const item of record.data["tools"]) {
        const named = z
          .object({ name: z.literal(["bash", "write_file", "workspace_open"]) })
          .safeParse(item);
        if (!named.success) continue;
        if (named.data.name === "workspace_open") {
          openers += 1;
          continue;
        }
        slots += 1;
        const tool = compiledToolSchema.safeParse(item);
        if (tool.success)
          workflows.push({
            name: tool.data.name,
            workflowId: tool.data.behavior.handling.workflowId,
          });
      }
    }
    for (const item of Object.values(record.data)) visit(item);
  };
  visit(tree);
  if (slots !== 26)
    throw new Error("Expected bash and write_file on the root and all 12 specialists");
  if (workflows.length === 0 && openers === 0)
    return { mode: "native" as const, workflows, driver: "" };
  if (workflows.length !== 26 || openers !== 13)
    throw new Error("Expected checkpointed bash and write_file on the root and all 12 specialists");
  const start = source.indexOf("const workflowCode = Buffer.from(");
  const end = source.indexOf('].join(""), "base64")', start);
  if (start < 0 || end < start) throw new Error("Compiled Workflow driver is missing");
  const chunks = source.slice(start, end).match(/"[A-Za-z0-9+/=]+"/gu);
  if (chunks === null) throw new Error("Compiled Workflow driver encoding changed");
  const driver = Buffer.from(
    chunks.map((part) => z.string().parse(JSON.parse(part))).join(""),
    "base64",
  ).toString("utf8");
  return { mode: "durable" as const, workflows, driver };
}
