import { describe, expect, test } from "bun:test";

import type { ParkedPayload, RenderArtifact, RenderIntent } from "@repo/shared/wire";

import { createRenderPublisher } from "../../agent/lib/discord/render-intent.ts";

const intent: RenderIntent = {
  dispatchId: "c46bc075-a794-42b3-bf7f-031b406d31b9",
  continuationKey: "1463772489380401310",
  messageId: "1571732555932111022",
  sessionId: "test-session",
  eveTurnId: "turn_0",
  revision: 1,
  phase: "completed",
  text: "Chart attached.",
  activity: "",
};
const parked: ParkedPayload = {
  dispatchId: intent.dispatchId,
  continuationKey: intent.continuationKey,
  messageId: intent.messageId,
  sessionId: intent.sessionId,
  eveTurnId: intent.eveTurnId,
};
const files: RenderArtifact[] = ["png", "svg", "csv"].map((extension, index) => ({
  id: String(index + 1).repeat(32),
  filename: `chart.${extension}`,
  mediaType: extension === "csv" ? "text/csv" : `image/${extension}`,
  bytes: 100,
  sha256: "a".repeat(64),
  description: "Test chart",
}));

function fixture(artifacts: () => Promise<RenderArtifact[] | undefined>) {
  const publications: RenderIntent[] = [];
  const settled: RenderIntent[] = [];
  const publisher = createRenderPublisher({
    store: {
      publish: async (frame) => {
        publications.push(frame);
        return { accepted: true, shouldWake: false };
      },
      settleAndPark: async (frame, payload) => {
        expect(payload).toEqual(parked);
        settled.push(frame);
        return frame.revision;
      },
    },
    artifacts,
    botUrl: async () => "https://example.com",
    botSecret: "fixture",
  });
  return { publisher, publications, settled };
}

describe("Discord chart completion", () => {
  test("the final parked frame retains files from a completed publication", async () => {
    const { publisher, publications, settled } = fixture(async () => files);
    await publisher.publish(intent);
    await publisher.settleAndPark({ ...intent, revision: 2 }, parked);
    expect(publications[0]?.artifacts).toEqual(files);
    expect(settled[0]?.artifacts).toEqual(files);
  });

  test("completion can attach files without any earlier completed publication", async () => {
    const { publisher, settled } = fixture(async () => files);
    await publisher.settleAndPark(intent, parked);
    expect(settled[0]?.artifacts).toEqual(files);
  });

  test("disabled delivery and failed turns do not attach files", async () => {
    const disabled = fixture(async () => undefined);
    await disabled.publisher.settleAndPark(intent, parked);
    expect(disabled.settled[0]?.artifacts).toBeUndefined();
    const failed = fixture(async () => {
      throw new Error("failed turns must not load chart files");
    });
    await failed.publisher.settleAndPark({ ...intent, phase: "failed" }, parked);
    expect(failed.settled[0]?.artifacts).toBeUndefined();
  });
});
