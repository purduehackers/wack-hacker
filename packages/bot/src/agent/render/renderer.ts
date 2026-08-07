/** Applies one coalesced desired agent presentation through Discord. */

import { createHash } from "node:crypto";

import { Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { sliceText, splitText } from "@repo/shared/text";
import type { RESTPostAPIChannelMessageJSONBody } from "discord.js";

import type { DiscordError, DiscordRest } from "./discord-rest.ts";

export const MAX_MESSAGE_CHARS = 1_900;
export const MAX_MESSAGES = 5;
const LIVE_CONTINUES = "-# response continues…";
const TRUNCATED = "-# response truncated";

export interface OverflowProjection {
  messageId: string;
  contentHash?: string;
}

export interface RendererProjection {
  anchorMessageId?: string;
  anchorContentHash?: string;
  overflow: OverflowProjection[];
}

export interface RenderInput {
  readonly text: string;
  readonly activity: string;
  readonly footer?: string;
  readonly notice?: string;
  readonly components?: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]>;
  readonly terminal: boolean;
}

export function renderBody(input: Omit<RenderInput, "terminal">): string {
  const sections: string[] = [];
  if (input.activity !== "") sections.push(`-# ${input.activity}`);
  if (input.text !== "") sections.push(input.text);
  if (input.footer !== undefined && input.footer !== "") sections.push(`-# ${input.footer}`);
  if (input.notice !== undefined && input.notice !== "") sections.push(input.notice);
  return sections.join("\n");
}

function liveChunk(input: RenderInput): string {
  const notice = input.notice === undefined ? "" : sliceText(input.notice, 900);
  const { notice: _notice, terminal: _terminal, ...bodyInput } = input;
  const body = renderBody(bodyInput);
  if (notice === "") {
    if (body.length <= MAX_MESSAGE_CHARS) return body;
    return `${sliceText(body, MAX_MESSAGE_CHARS - LIVE_CONTINUES.length - 2)}\n\n${LIVE_CONTINUES}`;
  }

  const available = MAX_MESSAGE_CHARS - notice.length - 2;
  const visibleBody =
    body.length <= available
      ? body
      : `${sliceText(body, available - LIVE_CONTINUES.length - 2)}\n\n${LIVE_CONTINUES}`;
  return visibleBody === "" ? notice : `${visibleBody}\n\n${notice}`;
}

function finalChunks(input: RenderInput): readonly string[] {
  const chunks = splitText(renderBody(input), MAX_MESSAGE_CHARS);
  if (chunks.length <= MAX_MESSAGES) return chunks;
  const visible = chunks.slice(0, MAX_MESSAGES);
  const last = visible.at(-1) ?? "";
  visible[visible.length - 1] =
    `${sliceText(last, MAX_MESSAGE_CHARS - TRUNCATED.length - 2)}\n\n${TRUNCATED}`;
  return visible;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("base64url").slice(0, 16);
}

function anchorHash(
  content: string,
  components: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]>,
): string {
  return hash(JSON.stringify([content, components]));
}

function nonce(messageId: string, index: number): string {
  // A Discord snowflake plus ':4' is at most 22 characters (limit: 25).
  return `${messageId}:${index}`;
}

export type RenderWriteError = DiscordError | Transient;

export interface RendererDeps {
  readonly rest: DiscordRest;
  readonly channelId: string;
  readonly sourceMessageId: string;
  readonly replyToMessageId?: string;
  /** Fenced durable checkpoint; called after every externally visible mutation. */
  readonly checkpoint: (state: RendererProjection) => Promise<boolean>;
  /** Renews and verifies ownership immediately before every Discord mutation. */
  readonly verifyLease: () => Promise<boolean>;
}

interface RenderContext {
  readonly deps: RendererDeps;
  readonly state: RendererProjection;
}

async function checkpoint(rendering: RenderContext): Promise<Result<undefined, Transient>> {
  if (await rendering.deps.checkpoint(rendering.state)) return Result.ok(undefined);
  return Result.err(
    new Transient({
      operation: "checkpoint Discord render projection",
      detail: "render lease was lost",
    }),
  );
}

async function verifyLease(rendering: RenderContext): Promise<Result<undefined, Transient>> {
  if (await rendering.deps.verifyLease()) return Result.ok(undefined);
  return Result.err(
    new Transient({
      operation: "verify Discord render lease",
      detail: "render lease was lost",
    }),
  );
}

async function createAnchor(
  rendering: RenderContext,
  content: string,
  components: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]>,
): Promise<Result<undefined, RenderWriteError>> {
  const { deps, state } = rendering;
  const owned = await verifyLease(rendering);
  if (Result.isError(owned)) return owned;
  const created =
    deps.replyToMessageId === undefined
      ? await deps.rest.postMessage(deps.channelId, {
          content,
          components,
          allowed_mentions: { parse: [] },
          nonce: nonce(deps.sourceMessageId, 0),
          enforce_nonce: true,
        })
      : await deps.rest.reply(
          deps.channelId,
          deps.replyToMessageId,
          content,
          nonce(deps.sourceMessageId, 0),
          components,
        );
  if (Result.isError(created)) return created;
  state.anchorMessageId = created.value.id;
  const responseMatches = created.value.content === content && components.length === 0;
  if (responseMatches) state.anchorContentHash = anchorHash(content, components);
  else delete state.anchorContentHash;
  const saved = await checkpoint(rendering);
  return Result.isError(saved) || responseMatches
    ? saved
    : writeAnchor(rendering, content, components, false);
}

async function writeAnchor(
  rendering: RenderContext,
  content: string,
  components: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]>,
  allowRecreate: boolean,
): Promise<Result<undefined, RenderWriteError>> {
  const { deps, state } = rendering;
  const contentHash = anchorHash(content, components);
  if (state.anchorContentHash === contentHash) return Result.ok(undefined);
  if (state.anchorMessageId === undefined) return createAnchor(rendering, content, components);

  const owned = await verifyLease(rendering);
  if (Result.isError(owned)) return owned;
  const edited = await deps.rest.editMessage(
    deps.channelId,
    state.anchorMessageId,
    content,
    components,
  );
  if (Result.isOk(edited)) {
    state.anchorContentHash = contentHash;
    return checkpoint(rendering);
  }
  if (!(allowRecreate && edited.error instanceof UpstreamError && edited.error.status === 404)) {
    return edited;
  }

  delete state.anchorMessageId;
  delete state.anchorContentHash;
  const saved = await checkpoint(rendering);
  return Result.isError(saved) ? saved : createAnchor(rendering, content, components);
}

async function createOverflow(
  rendering: RenderContext,
  index: number,
  content: string,
  contentHash: string,
): Promise<Result<undefined, RenderWriteError>> {
  const { deps, state } = rendering;
  const owned = await verifyLease(rendering);
  if (Result.isError(owned)) return owned;
  const created = await deps.rest.postMessage(deps.channelId, {
    content,
    allowed_mentions: { parse: [] },
    nonce: nonce(deps.sourceMessageId, index + 1),
    enforce_nonce: true,
  });
  if (Result.isError(created)) return created;
  const createdProjection: OverflowProjection = {
    messageId: created.value.id,
    ...(created.value.content === content ? { contentHash } : {}),
  };
  state.overflow.splice(index, 0, createdProjection);
  const saved = await checkpoint(rendering);
  if (Result.isError(saved) || created.value.content === content) return saved;

  const edited = await deps.rest.editMessage(deps.channelId, created.value.id, content);
  if (Result.isError(edited)) return edited;
  createdProjection.contentHash = contentHash;
  return checkpoint(rendering);
}

async function writeOverflow(
  rendering: RenderContext,
  chunks: readonly string[],
): Promise<Result<undefined, RenderWriteError>> {
  const { deps, state } = rendering;
  for (const [index, content] of chunks.entries()) {
    const contentHash = hash(content);
    const existing = state.overflow[index];
    if (existing?.contentHash === contentHash) continue;
    if (existing === undefined) {
      const created = await createOverflow(rendering, index, content, contentHash);
      if (Result.isError(created)) return created;
      continue;
    }

    const owned = await verifyLease(rendering);
    if (Result.isError(owned)) return owned;
    const edited = await deps.rest.editMessage(deps.channelId, existing.messageId, content);
    if (Result.isOk(edited)) {
      existing.contentHash = contentHash;
      const saved = await checkpoint(rendering);
      if (Result.isError(saved)) return saved;
      continue;
    }
    if (!(edited.error instanceof UpstreamError && edited.error.status === 404)) return edited;

    state.overflow.splice(index, 1);
    const saved = await checkpoint(rendering);
    if (Result.isError(saved)) return saved;
    const recreated = await createOverflow(rendering, index, content, contentHash);
    if (Result.isError(recreated)) return recreated;
  }
  return Result.ok(undefined);
}

async function removeStaleOverflow(
  rendering: RenderContext,
  keep: number,
): Promise<Result<undefined, RenderWriteError>> {
  const { deps, state } = rendering;
  while (state.overflow.length > keep) {
    const stale = state.overflow.at(-1);
    if (stale === undefined) break;
    const owned = await verifyLease(rendering);
    if (Result.isError(owned)) return owned;
    const deleted = await deps.rest.deleteMessage(deps.channelId, stale.messageId);
    if (Result.isError(deleted)) return deleted;
    state.overflow.pop();
    const saved = await checkpoint(rendering);
    if (Result.isError(saved)) return saved;
  }
  return Result.ok(undefined);
}

export function createRenderer(deps: RendererDeps, state: RendererProjection) {
  const rendering: RenderContext = { deps, state };
  return {
    write: async (input: RenderInput): Promise<Result<undefined, RenderWriteError>> => {
      if (!input.terminal) {
        return writeAnchor(rendering, liveChunk(input), input.components ?? [], false);
      }
      const [head = "", ...tail] = finalChunks(input);
      const anchor = await writeAnchor(rendering, head, [], true);
      if (Result.isError(anchor)) return anchor;
      const overflow = await writeOverflow(rendering, tail);
      return Result.isError(overflow) ? overflow : removeStaleOverflow(rendering, tail.length);
    },
  };
}
