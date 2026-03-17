import type { ActionEvent, Message } from "chat";
import type {
  GatewayMessageCreateDispatchData,
  APIInteractionGuildMember,
  Snowflake,
} from "discord-api-types/v10";

import type { DiscordRole as DiscordRoleValue } from "./types";

import { ORGANIZER_ROLE_ID, DIVISION_LEAD_ROLE_ID, DiscordRole } from "./constants";

/**
 * Normalized Discord user identity and role, extracted from either
 * a gateway message or an HTTP interaction (button click, slash command).
 */
export class DiscordContext {
  readonly userId: string;
  readonly username: string;
  readonly nickname: string;
  readonly role: DiscordRoleValue;

  private constructor(opts: {
    userId: string;
    username: string;
    nickname: string;
    roles: Snowflake[];
  }) {
    this.userId = opts.userId;
    this.username = opts.username;
    this.nickname = opts.nickname;
    this.role = DiscordContext.resolveRole(opts.roles);
  }

  private static resolveRole(roles: Snowflake[]) {
    if (roles.includes(ORGANIZER_ROLE_ID)) return DiscordRole.Organizer;
    if (roles.includes(DIVISION_LEAD_ROLE_ID)) return DiscordRole.DivisionLead;
    return DiscordRole.Public;
  }

  /**
   * Build from a gateway message forwarded via webhook.
   * `message.raw` is {@link GatewayMessageCreateDispatchData}.
   */
  static fromMessage(message: Message) {
    const raw = message.raw as GatewayMessageCreateDispatchData;
    const author = message.author;
    return new DiscordContext({
      userId: author.userId,
      username: author.userName ?? author.userId,
      nickname: author.fullName ?? author.userName ?? author.userId,
      roles: raw.member?.roles ?? [],
    });
  }

  /**
   * Build from an HTTP interaction (button click, slash command).
   * `event.raw` is an API interaction with `member?.roles`.
   */
  static fromAction(event: ActionEvent) {
    const interaction = event.raw as { member?: APIInteractionGuildMember };
    return new DiscordContext({
      userId: event.user.userId,
      username: event.user.userName ?? event.user.userId,
      nickname: event.user.fullName ?? event.user.userName ?? event.user.userId,
      roles: interaction.member?.roles ?? [],
    });
  }
}
