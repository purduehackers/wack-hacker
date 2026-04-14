import type {
  Packet,
  MessageCreatePacketType,
  MessageReactionAddPacketType,
  MessageReactionRemovePacketType,
  MessageDeletePacketType,
  MessageUpdatePacketType,
  VoiceStateUpdatePacketType,
  ThreadCreatePacketType,
} from "../protocol/types";
import type { HandlerContext } from "./types";

import { PacketCodec } from "../protocol/packets";
import { isBotMention } from "./mention";

export type { HandlerContext } from "./types";

type Handler<T> = (packet: T, ctx: HandlerContext) => Promise<void>;

export class EventRouter {
  private handlers = {
    mention: [] as Handler<MessageCreatePacketType>[],
    message: [] as Handler<MessageCreatePacketType>[],
    reactionAdd: [] as Handler<MessageReactionAddPacketType>[],
    reactionRemove: [] as Handler<MessageReactionRemovePacketType>[],
    messageDelete: [] as Handler<MessageDeletePacketType>[],
    messageUpdate: [] as Handler<MessageUpdatePacketType>[],
    voiceStateUpdate: [] as Handler<VoiceStateUpdatePacketType>[],
    threadCreate: [] as Handler<ThreadCreatePacketType>[],
  };

  onMention(h: Handler<MessageCreatePacketType>) {
    this.handlers.mention.push(h);
    return this;
  }
  onMessage(h: Handler<MessageCreatePacketType>) {
    this.handlers.message.push(h);
    return this;
  }
  onReactionAdd(h: Handler<MessageReactionAddPacketType>) {
    this.handlers.reactionAdd.push(h);
    return this;
  }
  onReactionRemove(h: Handler<MessageReactionRemovePacketType>) {
    this.handlers.reactionRemove.push(h);
    return this;
  }
  onMessageDelete(h: Handler<MessageDeletePacketType>) {
    this.handlers.messageDelete.push(h);
    return this;
  }
  onMessageUpdate(h: Handler<MessageUpdatePacketType>) {
    this.handlers.messageUpdate.push(h);
    return this;
  }
  onVoiceStateUpdate(h: Handler<VoiceStateUpdatePacketType>) {
    this.handlers.voiceStateUpdate.push(h);
    return this;
  }
  onThreadCreate(h: Handler<ThreadCreatePacketType>) {
    this.handlers.threadCreate.push(h);
    return this;
  }

  async route(raw: string, ctx: HandlerContext): Promise<void> {
    await this.dispatch(PacketCodec.decode(raw), ctx);
  }

  async dispatch(packet: Packet, ctx: HandlerContext): Promise<void> {
    const run = <T>(handlers: Handler<T>[], p: T) => Promise.all(handlers.map((h) => h(p, ctx)));

    switch (packet.type) {
      case "GATEWAY_MESSAGE_CREATE": {
        if (isBotMention(packet.data.content, ctx.botUserId)) {
          await run(this.handlers.mention, packet);
        }
        await run(this.handlers.message, packet);
        break;
      }
      case "GATEWAY_MESSAGE_REACTION_ADD":
        await run(this.handlers.reactionAdd, packet);
        break;
      case "GATEWAY_MESSAGE_REACTION_REMOVE":
        await run(this.handlers.reactionRemove, packet);
        break;
      case "GATEWAY_MESSAGE_DELETE":
        await run(this.handlers.messageDelete, packet);
        break;
      case "GATEWAY_MESSAGE_UPDATE":
        await run(this.handlers.messageUpdate, packet);
        break;
      case "GATEWAY_VOICE_STATE_UPDATE":
        await run(this.handlers.voiceStateUpdate, packet);
        break;
      case "GATEWAY_THREAD_CREATE":
        await run(this.handlers.threadCreate, packet);
        break;
    }
  }
}
