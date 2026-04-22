import type { ApprovalState } from "@/lib/ai/approvals";
import type { DiscordInteraction } from "@/lib/protocol/types";

import { InteractionType } from "@/lib/protocol/constants";

/** Build an `ApprovalState` with sensible defaults for store / handler tests. */
export function baseApprovalState(overrides: Partial<ApprovalState> = {}): ApprovalState {
  return {
    id: "a1",
    status: "pending",
    toolName: "doit",
    input: { foo: "bar" },
    reason: "because",
    channelId: "ch-1",
    messageId: "msg-5",
    requesterUserId: "user-1",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Build a minimal `MessageComponent` button-click interaction for handler tests. */
export function buttonInteraction(customId: string, clickerId: string): DiscordInteraction {
  return {
    id: "i-1",
    application_id: "app-1",
    type: InteractionType.MessageComponent,
    token: "tok-1",
    version: 1,
    member: {
      user: { id: clickerId, username: "alice" },
      roles: [],
    },
    data: { custom_id: customId, component_type: 2 },
  };
}
