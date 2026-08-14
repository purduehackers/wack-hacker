/// <reference types="node" />

/**
 * Renders `subagents/<domain>/README.md` from that domain's registry.
 *
 * The tool table is the part that rots: 689 rows nobody will hand-maintain past
 * the first rename. Generating it and having `check:capabilities` re-render in
 * memory and compare means the table is either correct or CI is red. That
 * script already does the same job for skill/tool coverage.
 *
 * Prose above the marker is hand-written and preserved.
 */

import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UserRole } from "@repo/shared/discord";
import {
  InvalidInput,
  InvariantViolated,
  messageOf,
  NotFound,
  serializeError,
  Transient,
} from "@repo/shared/errors";
import { fromNullable, Result } from "@repo/shared/result";
import { z } from "zod";

import { parseSkillDoc } from "../agent/lib/policy/skill-catalog.ts";
import { normalizeReadme, renderSubagentReadme, type SkillDoc } from "./lib/subagent-readme.ts";

const skillSchema = z.strictObject({
  name: z.string(),
  minRole: z.enum(UserRole),
  tools: z.array(z.string()),
  doc: z.string(),
});
const toolSpecSchema = z.looseObject({
  description: z.string(),
  access: z.looseObject({ risk: z.string(), minRole: z.enum(UserRole).optional() }),
});

/** Reports whether `path` exists. Any stat failure counts as absent. */
async function exists(path: string): Promise<boolean> {
  return Result.isOk(await Result.tryPromise(() => access(path)));
}

/** Validates one registry export, listing every failing path on rejection. */
function decodeExport<S extends z.ZodType>(
  schema: S,
  subject: string,
  value: unknown,
): Result<z.output<S>, InvalidInput> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return Result.ok(parsed.data);
  const issues = parsed.error.issues.map((failure) => {
    const path = failure.path.join(".");
    return path === "" ? failure.message : `${path}: ${failure.message}`;
  });
  return Result.err(new InvalidInput({ subject, issues }));
}

const outcome = await Result.gen(async function* () {
  const packageRootUrl = yield* fromNullable(
    URL.parse("..", import.meta.url),
    () =>
      new InvariantViolated({
        invariant: "import.meta.url parses as a URL",
        detail: import.meta.url,
      }),
  );
  const subagentsRoot = join(fileURLToPath(packageRootUrl), "agent/subagents");
  const entries = yield* Result.await(
    Result.tryPromise({
      try: () => readdir(subagentsRoot, { withFileTypes: true }),
      catch: () => new NotFound({ kind: "directory", id: subagentsRoot }),
    }),
  );
  const domainNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  let rendered = 0;
  for (const domain of domainNames) {
    const root = join(subagentsRoot, domain);
    if (!(await exists(join(root, "lib/registry.ts")))) continue;

    const constant = domain.toUpperCase().replaceAll("-", "_");
    // The registry module resolves at runtime, so its namespace arrives untyped.
    // The concrete schemas below validate every field this script consumes.
    const registry = yield* Result.await(
      Result.tryPromise({
        try: () => import(pathToFileURL(join(root, "lib/registry.ts")).href),
        catch: (cause) =>
          new InvariantViolated({
            invariant: `${domain} registry module loads`,
            detail: messageOf(cause),
          }),
      }),
    );
    const skillEntries = yield* decodeExport(
      z.array(skillSchema),
      `${domain} registry ${constant}_SKILLS`,
      registry[`${constant}_SKILLS`],
    );
    const baseTools = yield* decodeExport(
      z.array(z.string()),
      `${domain} registry ${constant}_BASE_TOOL_NAMES`,
      registry[`${constant}_BASE_TOOL_NAMES`],
    );
    const tools = yield* decodeExport(
      z.record(z.string(), toolSpecSchema),
      `${domain} registry ${constant}_TOOLS`,
      registry[`${constant}_TOOLS`],
    );

    const docs: SkillDoc[] = [];
    for (const skill of skillEntries) {
      const { description } = parseSkillDoc(skill.doc);
      if (description === "") {
        yield* new InvalidInput({
          subject: `${domain}/${skill.name}.md`,
          issues: ["needs a `description` in its frontmatter"],
        });
      }
      docs.push({ name: skill.name, minRole: skill.minRole, tools: skill.tools, description });
    }

    const readmePath = join(root, "README.md");
    const existing = (await exists(readmePath))
      ? yield* Result.await(
          Result.tryPromise({
            try: () => readFile(readmePath, "utf8"),
            catch: (cause) =>
              new Transient({ operation: `read ${readmePath}`, detail: messageOf(cause) }),
          }),
        )
      : undefined;
    const next = renderSubagentReadme({
      domain,
      skills: docs,
      baseTools,
      tools,
      ...(existing !== undefined && { existing }),
    });
    if (existing === undefined || normalizeReadme(next) !== normalizeReadme(existing)) {
      yield* Result.await(
        Result.tryPromise({
          try: () => writeFile(readmePath, next),
          catch: (cause) =>
            new Transient({ operation: `write ${readmePath}`, detail: messageOf(cause) }),
        }),
      );
      rendered += 1;
    }
  }
  return Result.ok({ rendered, scanned: domainNames.length });
});

outcome.match({
  ok: ({ rendered, scanned }) => {
    console.info(`readmes: ${rendered} written, ${scanned} subagents scanned`);
  },
  err: (error) => {
    const failure = serializeError(error);
    console.error(`render-subagent-readmes failed: ${failure.tag}: ${failure.message}`);
    process.exitCode = 1;
  },
});
