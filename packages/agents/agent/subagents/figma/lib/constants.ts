import type { WebhookV2Event } from "@figma/rest-api-spec";
import { z } from "zod";

/**
 * Input fields shared across this domain's tools.
 *
 * Figma keys files, nodes, comments, variables and dev resources off a file
 * key that only ever appears in a file's URL. So nearly every tool takes one.
 * Declaring it once keeps the description identical everywhere. The model
 * should always learn it can turn a file name into a key with `search_files`,
 * not only in the tools that say so.
 *
 * The response summarizers that pair with these inputs live in
 * `./projections.ts`.
 */

export const fileKey = z.string().describe("The file key (from the Figma URL)");

/** The events Figma can deliver to a team webhook. */
export const webhookEventSchema = z.enum([
  "PING",
  "FILE_UPDATE",
  "FILE_VERSION_UPDATE",
  "FILE_DELETE",
  "LIBRARY_PUBLISH",
  "FILE_COMMENT",
  "DEV_MODE_STATUS_UPDATE",
]) satisfies z.ZodType<WebhookV2Event>;
