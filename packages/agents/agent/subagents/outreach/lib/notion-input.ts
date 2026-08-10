import type {
  CreatePageParameters,
  QueryDataSourceParameters,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

type QueryFilter = NonNullable<QueryDataSourceParameters["filter"]>;
type QuerySorts = NonNullable<QueryDataSourceParameters["sorts"]>;
type CreateProperties = CreatePageParameters["properties"];

/** A JSON object — the shape every fragment of a Notion request body must have. */
const jsonObjectSchema = z.record(z.string(), z.json());
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

const queryTimestamp = z.enum(["created_time", "last_edited_time"]);
const propertyFilterSchema = z.looseObject({ property: z.string() });
const timestampFilterSchema = z.looseObject({ timestamp: queryTimestamp });
const sortDirection = z.enum(["ascending", "descending"]);
/** Exactly one sort target: a property name or a timestamp, never both nor neither. */
const querySortsSchema = z.array(
  z.xor([
    z.looseObject({ property: z.string(), direction: sortDirection }),
    z.looseObject({ timestamp: queryTimestamp, direction: sortDirection }),
  ]),
);

/** Narrow the legacy generic filter schema to the Notion SDK's recursive filter union. */
export function isQueryFilter(value: unknown): value is QueryFilter {
  const object = jsonObjectSchema.safeParse(value);
  if (!object.success) return false;
  const filter = object.data;
  const group = filter.and ?? filter.or;
  if (group !== undefined) return Array.isArray(group) && group.every(isQueryFilter);
  if (propertyFilterSchema.safeParse(filter).success) {
    return Object.entries(filter).some(
      ([key, condition]) => key !== "property" && jsonObjectSchema.safeParse(condition).success,
    );
  }
  const timestamp = timestampFilterSchema.safeParse(filter);
  if (timestamp.success) {
    return jsonObjectSchema.safeParse(filter[timestamp.data.timestamp]).success;
  }
  return false;
}

/** Require exactly one SDK sort target rather than forwarding an ambiguous record. */
export function isQuerySorts(value: unknown): value is QuerySorts {
  return querySortsSchema.safeParse(value).success;
}

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
