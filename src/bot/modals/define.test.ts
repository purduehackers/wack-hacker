import { describe, it, expect } from "vitest";

import type { InteractionResponsePayload } from "@/bot/commands/types";

import { InteractionResponseType } from "@/lib/protocol/constants";

import { defineModal } from "./define";

describe("defineModal", () => {
  it("returns the same handler", () => {
    const handler = {
      prefix: "foo",
      async handle(): Promise<InteractionResponsePayload> {
        return { type: InteractionResponseType.ChannelMessageWithSource };
      },
    };
    expect(defineModal(handler)).toBe(handler);
  });
});
