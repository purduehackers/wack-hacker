/** Applies one coalesced desired agent presentation through Discord. */

import { createHash } from "node:crypto";

import { Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { sliceText, splitText } from "@repo/shared/text";
import type { RESTPostAPIChannelMessageJSONBody } from "discord.js";

import type { DiscordError, DiscordRest } from "./discord-rest.ts";

const MAX_MESSAGE_CHARS = 1_900;
const MAX_MESSAGES = 5;
/**
 * Nonce slot for the input-request message.
 *
 * The anchor takes 0 and overflow takes 1..MAX_MESSAGES, so this sits past the
 * end of that range and cannot collide with a chunk.
 */
const HITL_NONCE_INDEX = MAX_MESSAGES + 1;
const LIVE_CONTINUES = "-# response continues…";
const TRUNCATED = "-# response truncated";

interface OverflowProjection {
  messageId: string;
  contentHash?: string;
}

export interface RendererProjection {
  anchorMessageId?: string;
  anchorContentHash?: string;
  /** See `renderProjectionSchema`: the input request lives on its own message. */
  hitlMessageId?: string;
  hitlContentHash?: string;
  hitlRequestKey?: string;
  overflow: OverflowProjection[];
}

interface RenderInput {
  readonly text: string;
  readonly activity: string;
  readonly footer?: string;
  readonly notice?: string;
  readonly components?: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]>;
  readonly mentionUserIds?: readonly string[];
  readonly hitlKey?: string;
  readonly terminal: boolean;
}

function renderBody(input: Omit<RenderInput, "terminal">): string {
  const sections: string[] = [];
  if (input.activity !== "") sections.push(`-# ${input.activity}`);
  if (input.text !== "") sections.push(input.text);
  if (input.footer !== undefined && input.footer !== "") sections.push(`-# ${input.footer}`);
  if (input.notice !== undefined && input.notice !== "") sections.push(input.notice);
  return sections.join("\n");
}

/**
 * The streaming body alone. The notice that used to be appended here now has its
 * own message, so a mention inside it arrives as a new message and pings.
 */
function liveChunk(input: RenderInput): string {
  const { notice: _notice, terminal: _terminal, hitlKey: _hitlKey, ...bodyInput } = input;
  const body = renderBody(bodyInput);
  if (body.length <= MAX_MESSAGE_CHARS) return body;
  return `${sliceText(body, MAX_MESSAGE_CHARS - LIVE_CONTINUES.length - 2)}\n\n${LIVE_CONTINUES}`;
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

/** A message someone deleted underneath us is not an error worth failing on. */
function isMissingMessage(error: RenderWriteError): boolean {
  return error instanceof UpstreamError && error.status === 404;
}

function nonce(messageId: string, index: number): string {
  // A Discord snowflake plus ':4' is at most 22 characters (limit: 25).
  return `${messageId}:${index}`;
}

/**
 * A nonce that is stable for one request and different for the next.
 *
 * `enforce_nonce` is what makes a retried post idempotent, so the value has to
 * stay the same across attempts at the same question. It also has to *change*
 * between questions: a turn that asks twice used to reuse one nonce for both,
 * and Discord answered the second post by returning the first message
 * unmodified — leaving the projection holding the new content's hash against a
 * message that still showed the old question, which no later render would
 * correct because the hash then matched. Four base64url characters of SHA-256
 * keep the whole value inside Discord's 25-character limit.
 */
function requestNonce(messageId: string, key: string): string {
  return `${messageId}:${hash(key).slice(0, 4)}`;
}

type RenderWriteError = DiscordError | Transient;

interface RendererDeps {
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
  if (!(allowRecreate && isMissingMessage(edited.error))) {
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
    if (!isMissingMessage(edited.error)) return edited;

    state.overflow.splice(index, 1);
    const saved = await checkpoint(rendering);
    if (Result.isError(saved)) return saved;
    const recreated = await createOverflow(rendering, index, content, contentHash);
    if (Result.isError(recreated)) return recreated;
  }
  return Result.ok(undefined);
}

/**
 * Take the controls off the message carrying the current request and forget it.
 *
 * Used both when a request is over and when a later one supersedes it. The
 * message itself is left in the channel: it is the thread's record that the
 * question was asked, and for one that was answered the interaction handler has
 * already written the outcome into it. This used to delete the message, which
 * erased that record — and, because the next request then reused the same
 * per-turn nonce, Discord returned the deleted message's slot instead of
 * posting the new question at all.
 */
async function retireRequestMessage(
  rendering: RenderContext,
): Promise<Result<undefined, RenderWriteError>> {
  const { deps, state } = rendering;
  if (state.hitlMessageId === undefined) return Result.ok(undefined);
  const owned = await verifyLease(rendering);
  if (Result.isError(owned)) return owned;
  const cleared = await deps.rest.clearComponents(deps.channelId, state.hitlMessageId);
  if (Result.isError(cleared) && !isMissingMessage(cleared.error)) return cleared;
  delete state.hitlMessageId;
  delete state.hitlContentHash;
  delete state.hitlRequestKey;
  return checkpoint(rendering);
}

/**
 * The input request, on a message of its own.
 *
 * Created rather than edited into place, and posted allowing exactly the
 * mentions the notice names. Both halves are required: the anchor is edited on
 * every streaming tick and Discord never notifies for an edit, and every render
 * message otherwise suppresses mentions so streamed prose cannot ping people.
 * Together they are why "Input required for @someone" arrived silently.
 *
 * One message per request: a turn that asks twice leaves two records rather
 * than editing the first into the second.
 */
async function writeHitl(
  rendering: RenderContext,
  notice: string | undefined,
  components: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]>,
  mentionUserIds: readonly string[],
  requestKey: string | undefined,
): Promise<Result<undefined, RenderWriteError>> {
  const { deps, state } = rendering;
  const content = notice ?? "";
  const wanted = content !== "" || components.length > 0;

  const superseded =
    state.hitlRequestKey !== undefined &&
    requestKey !== undefined &&
    state.hitlRequestKey !== requestKey;
  if (superseded) {
    const retired = await retireRequestMessage(rendering);
    if (Result.isError(retired)) return retired;
  }

  // A request that is no longer wanted has been answered, expired, or was
  // withdrawn. The message stays either way: it is the thread's record that the
  // question was asked, and for an answered one the interaction handler has
  // already written the outcome into it. Only the controls come off, and only
  // if they are still there — an answered request cleared them on the way out.
  if (!wanted) return retireRequestMessage(rendering);

  const contentHash = anchorHash(content, components);
  if (state.hitlMessageId !== undefined && state.hitlContentHash === contentHash) {
    return Result.ok(undefined);
  }

  const owned = await verifyLease(rendering);
  if (Result.isError(owned)) return owned;

  if (state.hitlMessageId !== undefined) {
    const edited = await deps.rest.editMessage(
      deps.channelId,
      state.hitlMessageId,
      content,
      components,
    );
    if (Result.isOk(edited)) {
      state.hitlContentHash = contentHash;
      if (requestKey !== undefined) state.hitlRequestKey = requestKey;
      return checkpoint(rendering);
    }
    if (!isMissingMessage(edited.error)) return edited;
    delete state.hitlMessageId;
    delete state.hitlContentHash;
    delete state.hitlRequestKey;
  }

  const created = await deps.rest.postMessage(deps.channelId, {
    content,
    components,
    allowed_mentions: { users: [...mentionUserIds] },
    nonce:
      requestKey === undefined
        ? nonce(deps.sourceMessageId, HITL_NONCE_INDEX)
        : requestNonce(deps.sourceMessageId, requestKey),
    enforce_nonce: true,
  });
  if (Result.isError(created)) return created;
  state.hitlMessageId = created.value.id;
  state.hitlContentHash = contentHash;
  if (requestKey !== undefined) state.hitlRequestKey = requestKey;
  return checkpoint(rendering);
}

/** Take the turn's own message back down; a deleted one is already gone. */
async function removeAnchor(
  rendering: RenderContext,
): Promise<Result<undefined, RenderWriteError>> {
  const { deps, state } = rendering;
  if (state.anchorMessageId === undefined) return Result.ok(undefined);
  const owned = await verifyLease(rendering);
  if (Result.isError(owned)) return owned;
  const removed = await deps.rest.deleteMessage(deps.channelId, state.anchorMessageId);
  if (Result.isError(removed) && !isMissingMessage(removed.error)) return removed;
  delete state.anchorMessageId;
  delete state.anchorContentHash;
  return checkpoint(rendering);
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
        // The anchor keeps only the streamed body; the request gets its own
        // message so its mention is delivered as a notification.
        const anchor = await writeAnchor(rendering, liveChunk(input), [], false);
        if (Result.isError(anchor)) return anchor;
        return writeHitl(
          rendering,
          input.notice,
          input.components ?? [],
          input.mentionUserIds ?? [],
          input.hitlKey,
        );
      }
      const [head = "", ...tail] = finalChunks(input);
      // A turn that was steered away before it said anything settles with no
      // body, and the footer alone is a message showing a bare reference id and
      // nothing else. There is nothing to report, so the anchor goes.
      if (head === "" && tail.length === 0) {
        const cleared = await removeAnchor(rendering);
        if (Result.isError(cleared)) return cleared;
        const hitl = await writeHitl(rendering, undefined, [], [], undefined);
        if (Result.isError(hitl)) return hitl;
        return removeStaleOverflow(rendering, 0);
      }
      const anchor = await writeAnchor(rendering, head, [], true);
      if (Result.isError(anchor)) return anchor;
      // A finished turn has nothing left to answer.
      const hitl = await writeHitl(rendering, undefined, [], [], undefined);
      if (Result.isError(hitl)) return hitl;
      const overflow = await writeOverflow(rendering, tail);
      return Result.isError(overflow) ? overflow : removeStaleOverflow(rendering, tail.length);
    },
  };
}
