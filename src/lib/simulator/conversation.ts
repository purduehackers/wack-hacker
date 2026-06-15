import type { API } from "@discordjs/core/http-only";

import type { ContextSnapshot } from "@/bot/context-snapshot";
import type { ConversationStore } from "@/bot/store";
import type { TurnMessageStore } from "@/bot/turn-message-store";
import type { HandlerContext } from "@/bot/types";
import type { ApprovalStoreLike } from "@/lib/ai/approvals";
import type {
  ChatMessage,
  ContextBreakdown,
  SerializedAgentContext,
  TurnUsage,
} from "@/lib/ai/types";
import type { DiscordInteraction, MessageCreatePacketType } from "@/lib/protocol/types";

import { buildToolApprovalHandler } from "@/bot/components/tool-approval";
import { prepareFreshTurn, replyEmptyMention } from "@/bot/handlers/events/mention";
import { isBotMention, isReplyToBot, stripBotMention } from "@/bot/mention";
import { AgentContext } from "@/lib/ai/context";
import { capHistory, stampCurrentTime, truncateForHistory } from "@/lib/ai/conversation-turn";
import { breakdownFromSnapshot } from "@/lib/ai/inspect-context";
import { buildContextSnapshot } from "@/lib/ai/snapshot";
import { streamTurn } from "@/lib/ai/streaming";
import { addTurnUsage, emptyTurnUsage } from "@/lib/ai/turn-usage";
import { createWideLogger } from "@/lib/logging/wide";

import type { SimEventBus } from "./event-bus.ts";
import type {
  SimApproveRequest,
  SimChatRequest,
  SimContextSnapshot,
  SimUsageSummary,
  VirtualChannel,
} from "./types.ts";
import type { VirtualGuild } from "./virtual-guild.ts";

import { SIM_BOT_ID, SIM_DEFAULT_CHANNEL, SIM_GUILD_ID, SIM_USER_ID } from "./constants.ts";
import { roleToMemberRoles } from "./context.ts";
import { createTracingOrchestratorFactory } from "./trace-orchestrator.ts";

interface SimConversationDeps {
  id: string;
  guild: VirtualGuild;
  bus: SimEventBus;
  coreApi: API;
  store: ConversationStore;
  approvalStore: ApprovalStoreLike;
  turnMessageStore: TurnMessageStore;
}

const EMPTY_USAGE: SimUsageSummary = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCallCount: 0,
  stepCount: 0,
  toolNames: [],
};

function toSummary(usage: TurnUsage): SimUsageSummary {
  return {
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    toolCallCount: usage.toolCallCount,
    stepCount: usage.stepCount,
    toolNames: usage.toolNames,
  };
}

/** Flatten the real `/inspect-context` snapshot + breakdown for the wire. */
function toSimSnapshot(snap: ContextSnapshot, breakdown: ContextBreakdown): SimContextSnapshot {
  return {
    model: snap.model,
    systemPrompt: snap.systemPrompt,
    tools: snap.tools.map((t) => ({ name: t.name, description: t.description })),
    context: snap.context,
    messages: snap.messages,
    categories: breakdown.categories.map((c) => ({
      label: c.label,
      chars: c.chars,
      estimatedTokens: c.estimatedTokens,
      items: c.items?.map((i) => ({ name: i.name, estimatedTokens: i.estimatedTokens })),
    })),
    estimatedInputTokens: breakdown.estimatedInputTokens,
    totalUsage: toSummary(snap.totalUsage),
    turnCount: breakdown.turnCount,
    totalCostUsd: breakdown.totalCostUsd,
  };
}

/**
 * Construct the Discord `MESSAGE_CREATE` packet the bot's router/handlers would
 * receive — so the sim drives the REAL mention detection + plumbing rather than
 * imitating it. A channel message pings via `mentions` + leading mention; an
 * in-thread message is framed as a reply to the bot so it continues there.
 */
function buildPacket(args: {
  req: SimChatRequest;
  baseChannel: VirtualChannel;
  thread: VirtualChannel | undefined;
  userMessageId: string;
  username: string;
  nickname: string;
  lastBotMessageId: string | undefined;
}): MessageCreatePacketType {
  const { req, baseChannel, thread, userMessageId, username, nickname, lastBotMessageId } = args;
  const pinged =
    req.content.includes(`<@${SIM_BOT_ID}>`) || req.content.includes(`<@!${SIM_BOT_ID}>`);
  const data = {
    id: userMessageId,
    attachments: [],
    author: { id: SIM_USER_ID, username, nickname },
    channel: thread
      ? { id: thread.id, name: thread.name }
      : { id: baseChannel.id, name: baseChannel.name },
    guildId: SIM_GUILD_ID,
    content: req.content,
    timestamp: new Date().toISOString(),
    mentions: pinged ? [SIM_BOT_ID] : [],
    memberRoles: roleToMemberRoles(req.role),
    ...(thread
      ? {
          thread: {
            id: thread.id,
            parentId: thread.parentId ?? baseChannel.id,
            parentName: baseChannel.name,
          },
          reference: { authorId: SIM_BOT_ID, messageId: lastBotMessageId, channelId: thread.id },
        }
      : {}),
  };
  return { type: "GATEWAY_MESSAGE_CREATE", timestamp: new Date(), data } as MessageCreatePacketType;
}

/**
 * A simulator conversation. Builds the real Discord packet + handler context
 * for each turn and drives the bot's own code — `isBotMention`/`stripBotMention`,
 * the mention handler's `prepareFreshTurn` (real thread creation, lead-in fetch,
 * placeholder, `AgentContext`), and `streamTurn` — so the sim exercises the same
 * plumbing as production rather than reimplementing it. Followup turns reuse the
 * pinned first-turn context, mirroring the chat workflow's resume path.
 */
export class SimConversation {
  readonly id: string;
  readonly guild: VirtualGuild;
  readonly bus: SimEventBus;
  readonly coreApi: API;
  readonly approvalStore: ApprovalStoreLike;
  private readonly store: ConversationStore;
  private readonly turnMessageStore: TurnMessageStore;

  private messages: ChatMessage[] = [];
  private turnCount = 0;
  private totalUsage = emptyTurnUsage();
  private stableContext: SerializedAgentContext | undefined;
  private lastBotMessageId: string | undefined;

  constructor(deps: SimConversationDeps) {
    this.id = deps.id;
    this.guild = deps.guild;
    this.bus = deps.bus;
    this.coreApi = deps.coreApi;
    this.store = deps.store;
    this.approvalStore = deps.approvalStore;
    this.turnMessageStore = deps.turnMessageStore;
  }

  async runTurn(req: SimChatRequest): Promise<void> {
    const username = req.username ?? "sim-user";
    const nickname = req.nickname ?? username;
    const channel = this.guild.ensureChannel(req.channelName ?? SIM_DEFAULT_CHANNEL);
    this.guild.addMember({
      id: SIM_USER_ID,
      username,
      displayName: nickname,
      roles: roleToMemberRoles(req.role),
    });
    this.bus.emit({ type: "guild.sync", guild: this.guild.snapshot() });

    const continuingThread = req.threadId ? this.guild.getChannel(req.threadId) : undefined;
    const inThread = continuingThread?.kind === "thread";
    const target = inThread ? continuingThread : channel;

    // The user posts their own message — the sim is the "Discord" delivering it.
    const userMessage = this.guild.createMessage(target.id, {
      authorId: SIM_USER_ID,
      authorKind: "user",
      content: req.content,
    });
    this.bus.emit({ type: "message.create", message: userMessage });

    const packet = buildPacket({
      req,
      baseChannel: channel,
      thread: inThread ? continuingThread : undefined,
      userMessageId: userMessage.id,
      username,
      nickname,
      lastBotMessageId: this.lastBotMessageId,
    });
    const ctx: HandlerContext = { discord: this.coreApi, store: this.store, botUserId: SIM_BOT_ID };

    // Real gate: the bot engages only when pinged in a channel, or when the
    // message replies to it inside its thread (mirrors the router's logic).
    if (!isBotMention(packet.data, SIM_BOT_ID) && !isReplyToBot(packet.data, SIM_BOT_ID)) {
      this.emitSilent();
      return;
    }

    const content = stripBotMention(req.content, SIM_BOT_ID);
    if (!content) {
      await replyEmptyMention(this.coreApi, target.id);
      this.emitSilent();
      return;
    }

    const { channelId, threadId, context, placeholderMessageId } = await this.resolveTurn({
      packet,
      ctx,
      content,
      channel,
      continuingThread: inThread ? continuingThread : undefined,
    });

    this.bus.emit({
      type: "run.start",
      turnIndex: this.turnCount + 1,
      channelId,
      threadId,
    });

    const turnContent = this.turnCount === 0 ? content : stampCurrentTime(content, context.nowISO);
    this.messages.push({ role: "user", content: turnContent });

    try {
      const result = await streamTurn(this.coreApi, channelId, this.messages, context, {
        workflowRunId: this.id,
        turnIndex: this.turnCount + 1,
        turnMessageStore: this.turnMessageStore,
        placeholderMessageId,
        // Run the real orchestrator, teeing its stream into the bus so the
        // inspector's Trace tab populates as tool calls happen.
        createAgent: createTracingOrchestratorFactory(this.bus),
      });
      this.messages.push({ role: "assistant", content: truncateForHistory(result.text) });
      this.lastBotMessageId = result.discordMessageId;
      await capHistory(this.messages);
      this.turnCount += 1;
      this.totalUsage = addTurnUsage(this.totalUsage, result.usage);
      // Inspector "Context" tab: snapshot what the model saw, before the
      // terminal run.finish frame (the SSE pump stops on run.finish).
      await this.emitContextSnapshot(context);
      this.bus.emit({
        type: "run.finish",
        turnIndex: this.turnCount,
        discordMessageId: result.discordMessageId,
        model: result.model,
        text: result.text,
        usage: toSummary(result.usage),
      });
    } catch (err) {
      this.messages.pop();
      this.bus.emit({
        type: "run.error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Fresh channel mention → run the bot's real `prepareFreshTurn` (real thread
   * creation, lead-in fetch, placeholder, AgentContext) and pin its context.
   * Followup inside a thread → reuse the pinned context, like the workflow's
   * resume path (no new thread, renderer makes its own placeholder).
   */
  private async resolveTurn(args: {
    packet: MessageCreatePacketType;
    ctx: HandlerContext;
    content: string;
    channel: VirtualChannel;
    continuingThread: VirtualChannel | undefined;
  }): Promise<{
    channelId: string;
    threadId: string | undefined;
    context: SerializedAgentContext;
    placeholderMessageId: string | undefined;
  }> {
    const { packet, ctx, content, channel, continuingThread } = args;
    if (continuingThread) {
      const context = this.stableContext ?? AgentContext.fromPacket(packet).toJSON();
      return {
        channelId: continuingThread.id,
        threadId: continuingThread.id,
        context,
        placeholderMessageId: undefined,
      };
    }
    const logger = createWideLogger({ op: "sim.mention", chat: { channel_id: channel.id } });
    const routing = {
      sourceChannelId: channel.id,
      lookupThreadId: undefined,
      alreadyInThread: false,
    };
    const payload = await prepareFreshTurn({ packet, ctx, content, routing, logger });
    this.stableContext = payload.context;
    return {
      channelId: payload.channelId,
      threadId: payload.context.thread?.id,
      context: payload.context,
      placeholderMessageId: payload.placeholderMessageId,
    };
  }

  /**
   * Drive the REAL Discord approval-button handler (auth rules, ephemeral
   * rejections, decision-embed swap) against the virtual core API + shared
   * store. The waiting tool wrapper unblocks on the resulting `store.decide`.
   */
  async decide(req: SimApproveRequest): Promise<{ ok: boolean }> {
    const handler = buildToolApprovalHandler(this.approvalStore);
    const clickerId = req.clickerUserId ?? SIM_USER_ID;
    const clickerRoles = req.clickerRoles ?? this.guild.getMember(clickerId)?.roles ?? [];
    const interaction = {
      application_id: "sim-app",
      token: "sim-token",
      member: { user: { id: clickerId }, roles: clickerRoles },
    } as unknown as DiscordInteraction;
    await handler.handle({
      interaction,
      discord: this.coreApi,
      customId: `tool-approval:${req.decision}:${req.approvalId}`,
    });
    return { ok: true };
  }

  /**
   * Build + emit the real `/inspect-context` snapshot for the conversation so
   * the inspector can show exactly what the model saw. Best-effort — a snapshot
   * failure must never break the turn.
   */
  private async emitContextSnapshot(context: SerializedAgentContext): Promise<void> {
    try {
      const snap = buildContextSnapshot({
        context: this.stableContext ?? context,
        messages: this.messages,
        totalUsage: this.totalUsage,
        turnCount: this.turnCount,
      });
      const breakdown = await breakdownFromSnapshot(snap);
      this.bus.emit({ type: "context.snapshot", snapshot: toSimSnapshot(snap, breakdown) });
    } catch {
      // Inspector data is non-essential; swallow.
    }
  }

  /** Terminal event for a silent turn (bot not engaged) so the SSE stream closes. */
  private emitSilent(): void {
    this.bus.emit({
      type: "run.finish",
      turnIndex: this.turnCount,
      discordMessageId: "",
      model: "n/a",
      text: "",
      usage: EMPTY_USAGE,
    });
  }
}
