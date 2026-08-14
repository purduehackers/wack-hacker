/**
 * @fileoverview Runtime type guards for Notion request fragments.
 *
 * The Notion SDK ships parameter types with no runtime validators, and tool
 * input arrives as untyped JSON from the model. Each guard checks the
 * structure the SDK type demands, so a malformed fragment fails at the tool
 * boundary, not deep inside a Notion call.
 */

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
type JsonValue = z.output<typeof jsonValueSchema>;
/** A JSON object — the shape every fragment of a Notion request body must have. */
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
type JsonObject = z.output<typeof jsonObjectSchema>;

const pagePropertyKind = z.enum([
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
]) satisfies z.ZodType<PagePropertyKind>;
const dataSourcePropertyKind = z.enum([
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
]) satisfies z.ZodType<DataSourcePropertyKind>;
const blockKind = z.enum([
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
]) satisfies z.ZodType<BlockKind>;

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
const titlePropertySchema = z.looseObject({ title: jsonValueSchema });
const renamedPropertySchema = z.looseObject({ name: z.string() });
const updateBlockEnvelopeSchema = z.looseObject({
  block_id: z.string(),
  in_trash: z.boolean().optional(),
});
const appendBlockEnvelopeSchema = z.looseObject({
  block_id: z.string(),
  children: z.array(jsonObjectSchema).min(1),
  after: z.string().optional(),
});
const updateBlockMetadataKey = z.enum(["block_id", "in_trash", "type"]);
const appendBlockMetadataKey = z.enum(["object", "type"]);

function hasPropertyKind(value: JsonValue, kind: z.ZodType<string>): boolean {
  const object = jsonObjectSchema.safeParse(value);
  return object.success && Object.keys(object.data).some((key) => kind.safeParse(key).success);
}

/**
 * Narrows raw JSON to the SDK's query filter union. An `and`/`or` group must
 * recurse, and a property or timestamp leaf must carry a nested condition
 * object. The check is structural, so an obviously malformed filter never
 * reaches the Notion API.
 */
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

/**
 * Narrows raw JSON to the SDK's sort list. Each entry must name exactly one
 * target — a property or a timestamp — never both nor neither.
 */
export function isQuerySorts(value: unknown): value is QuerySorts {
  return querySortsSchema.safeParse(value).success;
}

/**
 * Narrows raw JSON to page properties for a create call. Every value must
 * carry at least one known property-kind key, so a bag of bare scalars cannot
 * pass as a property map.
 */
export function isCreatePageProperties(value: unknown): value is CreatePageProperties {
  const object = jsonObjectSchema.safeParse(value);
  return (
    object.success &&
    Object.values(object.data).every((item) => hasPropertyKind(item, pagePropertyKind))
  );
}

/**
 * Update accepts the same property shapes as create, so this reuses the
 * create-side guard rather than maintaining a second kind list.
 */
export function isUpdatePageProperties(value: unknown): value is UpdatePageProperties {
  return isCreatePageProperties(value);
}

/**
 * Narrows raw JSON to a new data source's property schema. Every value must
 * carry a known property kind, and at least one entry must be a `title`
 * property, because Notion requires one.
 */
export function isCreateDataSourceProperties(value: unknown): value is CreateDataSourceProperties {
  const object = jsonObjectSchema.safeParse(value);
  if (!object.success) return false;
  const properties = Object.values(object.data);
  return (
    properties.every((item) => hasPropertyKind(item, dataSourcePropertyKind)) &&
    properties.some((item) => titlePropertySchema.safeParse(item).success)
  );
}

/**
 * Narrows raw JSON to a data source schema update. A value may be `null` to
 * remove a property, a bare rename, or a typed property change. Nothing
 * outside those three forms passes.
 */
export function isUpdateDataSourceProperties(value: unknown): value is UpdateDataSourceProperties {
  const object = jsonObjectSchema.safeParse(value);
  return (
    object.success &&
    Object.values(object.data).every(
      (item) =>
        item === null ||
        renamedPropertySchema.safeParse(item).success ||
        hasPropertyKind(item, dataSourcePropertyKind),
    )
  );
}

function hasSingleBlockKind(value: JsonObject, metadataKey: z.ZodType<string>): boolean {
  const propertyNames = Object.keys(value);
  if (
    !propertyNames.every(
      (candidate) =>
        metadataKey.safeParse(candidate).success || blockKind.safeParse(candidate).success,
    )
  ) {
    return false;
  }
  const present = propertyNames.filter((candidate) => blockKind.safeParse(candidate).success);
  if (present.length > 1) return false;
  if (!present.every((candidate) => jsonObjectSchema.safeParse(value[candidate]).success)) {
    return false;
  }
  if (value.type === undefined) return true;
  // `present[0]` is a block-kind name, so this also rejects a non-string `type`
  // and a `type` declared with no matching block payload.
  return present[0] === value.type;
}

/**
 * Narrows raw JSON to a block update. The envelope must carry a `block_id`,
 * and the body may hold at most one block-kind payload, because a block only
 * ever has one type.
 */
export function isUpdateBlockParameters(value: unknown): value is UpdateBlockParameters {
  const object = jsonObjectSchema.safeParse(value);
  return (
    object.success &&
    updateBlockEnvelopeSchema.safeParse(object.data).success &&
    hasSingleBlockKind(object.data, updateBlockMetadataKey)
  );
}

/**
 * Narrows raw JSON to an append-children call. The children list must not be
 * empty, and every child must carry exactly one block-kind payload, so each
 * appended block has a definite type.
 */
export function isAppendBlockChildrenParameters(
  value: unknown,
): value is AppendBlockChildrenParameters {
  const object = jsonObjectSchema.safeParse(value);
  if (!object.success) return false;
  const envelope = appendBlockEnvelopeSchema.safeParse(object.data);
  return (
    envelope.success &&
    envelope.data.children.every(
      (child) =>
        hasSingleBlockKind(child, appendBlockMetadataKey) &&
        Object.keys(child).some((key) => blockKind.safeParse(key).success),
    )
  );
}
