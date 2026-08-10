import type {
  GetProjectFilesResponse,
  PublishedComponent,
  PublishedComponentSet,
  PublishedStyle,
  WebhookV2,
  WebhookV2Event,
} from "@figma/rest-api-spec";
import { z } from "zod";

import { figmaFileUrl } from "./client.ts";

/**
 * Input fields and response shapes shared across this domain's tools.
 *
 * Figma keys files, nodes, comments, variables and dev resources off a file key
 * that only ever appears in a file's URL, so nearly every tool takes one.
 * Declaring it once keeps the description identical everywhere — the model
 * should always learn it can turn a file name into a key with `search_files`,
 * not only in the tools that happen to say so.
 *
 * The summarizers are the other half. Figma's REST responses are wide and
 * snake_cased, and each summarizer is the single shape this domain returns for
 * that entity, so a component reads the same whether it arrived from a team
 * listing or a single lookup.
 */

export const fileKey = z.string().describe("The file key (from the Figma URL)");

export function summarizeFile(
  file: GetProjectFilesResponse["files"][number],
  projectName?: string,
) {
  return {
    key: file.key,
    name: file.name,
    lastModified: file.last_modified,
    thumbnailUrl: file.thumbnail_url,
    url: figmaFileUrl(file.key),
    ...(projectName ? { projectName } : {}),
  };
}

/** Component sets carry the same published metadata as components, so one shape covers both. */
export function summarizeComponent(component: PublishedComponent | PublishedComponentSet) {
  return {
    key: component.key,
    name: component.name,
    description: component.description,
    fileKey: component.file_key,
    nodeId: component.node_id,
    thumbnailUrl: component.thumbnail_url,
    createdAt: component.created_at,
    updatedAt: component.updated_at,
  };
}

export function summarizeStyle(style: PublishedStyle) {
  return {
    key: style.key,
    name: style.name,
    description: style.description,
    styleType: style.style_type,
    fileKey: style.file_key,
    nodeId: style.node_id,
    thumbnailUrl: style.thumbnail_url,
    createdAt: style.created_at,
    updatedAt: style.updated_at,
  };
}

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

export function summarizeWebhook(webhook: WebhookV2) {
  return {
    id: webhook.id,
    eventType: webhook.event_type,
    context: webhook.context,
    contextId: webhook.context_id,
    endpoint: webhook.endpoint,
    status: webhook.status,
    description: webhook.description,
  };
}
