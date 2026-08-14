/**
 * @fileoverview Response summarizers shared across this domain's tools.
 *
 * Figma's REST responses are wide and snake_cased. Each summarizer is the
 * single shape this domain returns for that entity. A component then reads
 * the same whether it arrived from a team listing or a single lookup.
 */

import type {
  GetProjectFilesResponse,
  PublishedComponent,
  PublishedComponentSet,
  PublishedStyle,
  WebhookV2,
} from "@figma/rest-api-spec";

import { figmaFileUrl } from "./client.ts";

/**
 * The single shape this domain returns for a file. It carries the file key
 * and a ready-made URL together, so the model never has to reassemble one
 * from the other.
 */
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
    ...(projectName !== undefined && projectName !== "" && { projectName }),
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

/**
 * The single shape this domain returns for a published style, keyed the same
 * way as components so both kinds of library entry read alike.
 */
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

/**
 * The single shape this domain returns for a webhook. Status and endpoint
 * stay visible so the model can tell an active hook from a paused or
 * misdirected one.
 */
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
