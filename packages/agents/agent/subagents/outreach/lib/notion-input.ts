import type {
  CreatePageParameters,
  QueryDataSourceParameters,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

type QueryFilter = NonNullable<QueryDataSourceParameters["filter"]>;
type QuerySorts = NonNullable<QueryDataSourceParameters["sorts"]>;
type CreateProperties = CreatePageParameters["properties"];
type UpdateProperties = UpdatePageParameters["properties"];

const jsonRecordSchema = z.record(z.string(), z.json());
const propertyKinds = new Set([
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow the legacy generic filter schema to the Notion SDK's recursive filter union. */
export function isQueryFilter(value: unknown): value is QueryFilter {
  if (!isRecord(value) || !jsonRecordSchema.safeParse(value).success) return false;
  const group = value.and ?? value.or;
  if (group !== undefined) return Array.isArray(group) && group.every(isQueryFilter);
  if (typeof value.property === "string") {
    return Object.entries(value).some(
      ([key, condition]) => key !== "property" && isRecord(condition),
    );
  }
  if (value.timestamp === "created_time" || value.timestamp === "last_edited_time") {
    return isRecord(value[value.timestamp]);
  }
  return false;
}

/** Require exactly one SDK sort target rather than forwarding an ambiguous record. */
export function isQuerySorts(value: unknown): value is QuerySorts {
  return (
    Array.isArray(value) &&
    value.every(
      (sort) =>
        isRecord(sort) &&
        (sort.direction === "ascending" || sort.direction === "descending") &&
        (typeof sort.property === "string") !==
          (sort.timestamp === "created_time" || sort.timestamp === "last_edited_time"),
    )
  );
}

function isPropertyMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (property) =>
        isRecord(property) && Object.keys(property).some((key) => propertyKinds.has(key)),
    )
  );
}

export function isCreateProperties(value: unknown): value is CreateProperties {
  return isPropertyMap(value);
}

export function isUpdateProperties(value: unknown): value is UpdateProperties {
  return isPropertyMap(value);
}
