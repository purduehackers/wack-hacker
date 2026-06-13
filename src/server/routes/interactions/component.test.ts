import { describe, expect, it } from "vitest";

import { InteractionResponseType } from "@/lib/protocol/constants";
import { buttonInteraction } from "@/lib/test/fixtures";

import { handleMessageComponent } from "./component.ts";
import { EPHEMERAL_FLAG } from "./constants.ts";

describe("handleMessageComponent", () => {
  it("tells the user when a component prefix has no registered handler", () => {
    const result = handleMessageComponent(buttonInteraction("ghost:42", "user-1"));

    expect(result).toEqual({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: "This button is no longer active.", flags: EPHEMERAL_FLAG },
    });
  });

  it("rejects interactions without a custom_id", () => {
    const interaction = buttonInteraction("ghost:42", "user-1");
    delete interaction.data?.custom_id;

    expect(handleMessageComponent(interaction)).toEqual({
      error: "Missing custom_id",
      status: 400,
    });
  });
});
