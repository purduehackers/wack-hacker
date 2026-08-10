import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

/**
 * The CRM's own Notion input guard.
 *
 * Query filter and sort validation is Notion's and is re-exported rather than
 * copied — this module used to carry its own forks of both, which had begun to
 * drift from the originals.
 */
export { isQueryFilter, isQuerySorts } from "../../notion/lib/notion-input.ts";

type CreateProperties = CreatePageParameters["properties"];

/** A JSON object — the shape every fragment of a Notion request body must have. */
const jsonObjectSchema = z.record(z.string(), z.json());

/**
 * The property kinds a CRM row is built from.
 *
 * Narrower than `notion`'s equivalent on purpose: a Company, Contact or Deal is
 * created from this fixed set, so a body carrying anything else is a mistake
 * worth rejecting rather than forwarding.
 */
const propertyKind = z.enum([
  "title",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "people",
  "files",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "relation",
]);

export function isCreateProperties(value: unknown): value is CreateProperties {
  const object = jsonObjectSchema.safeParse(value);
  return (
    object.success &&
    Object.values(object.data).every((property) => {
      const candidate = jsonObjectSchema.safeParse(property);
      return (
        candidate.success &&
        Object.keys(candidate.data).some((key) => propertyKind.safeParse(key).success)
      );
    })
  );
}
