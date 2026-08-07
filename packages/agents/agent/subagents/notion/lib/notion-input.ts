import type {
  AppendBlockChildrenParameters,
  CreateDatabaseParameters,
  CreatePageParameters,
  QueryDataSourceParameters,
  UpdateBlockParameters,
  UpdateDataSourceParameters,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

type QueryFilter = NonNullable<QueryDataSourceParameters["filter"]>;
type QuerySorts = NonNullable<QueryDataSourceParameters["sorts"]>;
type CreatePageProperties = NonNullable<CreatePageParameters["properties"]>;
type UpdatePageProperties = NonNullable<UpdatePageParameters["properties"]>;
type CreateDataSourceProperties = NonNullable<
  NonNullable<CreateDatabaseParameters["initial_data_source"]>["properties"]
>;
type UpdateDataSourceProperties = NonNullable<UpdateDataSourceParameters["properties"]>;

type UnionKeys<T> = T extends unknown ? keyof T : never;
type CreatePageProperty = CreatePageProperties[string];
type DataSourceProperty = CreateDataSourceProperties[string];
type PagePropertyKind = Exclude<UnionKeys<CreatePageProperty>, "id" | "name" | "type">;
type DataSourcePropertyKind = Exclude<UnionKeys<DataSourceProperty>, "id" | "name" | "type">;
type AppendBlockChild = AppendBlockChildrenParameters["children"][number];
type BlockKind = Exclude<
  UnionKeys<UpdateBlockParameters | AppendBlockChild>,
  "after" | "block_id" | "children" | "in_trash" | "object" | "type"
>;

const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;
const jsonRecordSchema = z.record(z.string(), jsonValueSchema);
const pagePropertyKinds: ReadonlySet<PagePropertyKind> = new Set([
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
  "place",
  "verification",
]);
const dataSourcePropertyKinds: ReadonlySet<DataSourcePropertyKind> = new Set([
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
  "formula",
  "relation",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
]);
const blockKinds: ReadonlySet<BlockKind> = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "heading_4",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "code",
  "quote",
  "callout",
  "divider",
  "breadcrumb",
  "table_of_contents",
  "embed",
  "bookmark",
  "image",
  "video",
  "pdf",
  "file",
  "audio",
  "equation",
  "link_to_page",
  "table_row",
  "table",
  "column",
  "synced_block",
  "template",
]);

function contains<T extends string>(collection: ReadonlySet<T>, candidate: string): candidate is T {
  return collection.values().some((member) => member === candidate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return isRecord(value) && jsonRecordSchema.safeParse(value).success;
}

export function isQueryFilter(value: unknown): value is QueryFilter {
  if (!isJsonRecord(value)) return false;
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

function hasPropertyKind(value: unknown, kinds: ReadonlySet<string>): boolean {
  return isJsonRecord(value) && Object.keys(value).some((key) => contains(kinds, key));
}

export function isCreatePageProperties(value: unknown): value is CreatePageProperties {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => hasPropertyKind(item, pagePropertyKinds))
  );
}

export function isUpdatePageProperties(value: unknown): value is UpdatePageProperties {
  return isCreatePageProperties(value);
}

export function isCreateDataSourceProperties(value: unknown): value is CreateDataSourceProperties {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => hasPropertyKind(item, dataSourcePropertyKinds)) &&
    Object.values(value).some((item) => isRecord(item) && "title" in item)
  );
}

export function isUpdateDataSourceProperties(value: unknown): value is UpdateDataSourceProperties {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) =>
        item === null ||
        (isJsonRecord(item) &&
          (typeof item.name === "string" ||
            Object.keys(item).some((key) => contains(dataSourcePropertyKinds, key)))),
    )
  );
}

function hasSingleBlockKind(
  value: Record<string, unknown>,
  metadata: ReadonlySet<string>,
): boolean {
  const propertyNames = Object.keys(value);
  if (
    !propertyNames.every((candidate) => metadata.has(candidate) || contains(blockKinds, candidate))
  ) {
    return false;
  }
  const present = propertyNames.filter((candidate) => contains(blockKinds, candidate));
  if (present.length > 1 || !present.every((candidate) => isRecord(value[candidate]))) return false;
  if (value.type === undefined) return true;
  return typeof value.type === "string" && present[0] === value.type;
}

export function isUpdateBlockParameters(value: unknown): value is UpdateBlockParameters {
  return (
    isJsonRecord(value) &&
    typeof value.block_id === "string" &&
    (value.in_trash === undefined || typeof value.in_trash === "boolean") &&
    hasSingleBlockKind(value, new Set(["block_id", "in_trash", "type"]))
  );
}

export function isAppendBlockChildrenParameters(
  value: unknown,
): value is AppendBlockChildrenParameters {
  return (
    isJsonRecord(value) &&
    typeof value.block_id === "string" &&
    Array.isArray(value.children) &&
    value.children.length > 0 &&
    value.children.every(
      (child) =>
        isJsonRecord(child) &&
        hasSingleBlockKind(child, new Set(["object", "type"])) &&
        Object.keys(child).some((key) => contains(blockKinds, key)),
    ) &&
    (value.after === undefined || typeof value.after === "string")
  );
}
