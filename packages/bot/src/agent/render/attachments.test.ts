import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { synchronizeAttachments } from "./attachments.ts";
import type { AttachmentSync } from "./attachments.ts";

const body = Buffer.from("test attachment");
const descriptor = {
  id: "a".repeat(32),
  filename: "chart.png",
  mediaType: "image/png",
  bytes: body.length,
  sha256: createHash("sha256").update(body).digest("hex"),
};

function fixture() {
  let attachments: Array<{ id: string; filename: string }> = [];
  let writes = 0;
  let downloads = 0;
  let loseResponse = false;
  const rest: AttachmentSync["rest"] = {
    get: async () => ({ attachments }),
    patch: async () => {
      writes += 1;
      attachments = [
        { id: "discord-attachment", filename: `wack-${descriptor.id}-${descriptor.filename}` },
      ];
      if (loseResponse) {
        loseResponse = false;
        throw new Error("connection lost after Discord saved the file");
      }
      return { attachments };
    },
  };
  const options: AttachmentSync = {
    rest,
    channelId: "channel",
    messageId: "anchor",
    artifacts: [descriptor],
    load: async () => {
      downloads += 1;
      return body;
    },
    beforeWrite: async () => true,
  };
  return {
    options,
    counts: () => ({ writes, downloads }),
    loseResponse: () => {
      loseResponse = true;
    },
  };
}

describe("Discord attachment recovery", () => {
  test("a replay or restart reuses existing Discord attachments", async () => {
    const setup = fixture();
    expect(await synchronizeAttachments(setup.options)).toEqual(["discord-attachment"]);
    expect(await synchronizeAttachments(setup.options)).toEqual(["discord-attachment"]);
    expect(setup.counts()).toEqual({ writes: 1, downloads: 1 });
  });
  test("lost upload response is recovered without a duplicate upload", async () => {
    const setup = fixture();
    setup.loseResponse();
    expect(await rejected(synchronizeAttachments(setup.options))).toContain("connection lost");
    expect(await synchronizeAttachments(setup.options)).toEqual(["discord-attachment"]);
    expect(setup.counts().writes).toBe(1);
  });
  test("stale leases and corrupted bytes cannot write to Discord", async () => {
    const setup = fixture();
    expect(
      await rejected(synchronizeAttachments({ ...setup.options, beforeWrite: async () => false })),
    ).toContain("lease lost");
    expect(
      await rejected(
        synchronizeAttachments({ ...setup.options, load: async () => Buffer.from("corrupt") }),
      ),
    ).toContain("integrity");
    expect(setup.counts().writes).toBe(0);
  });
});

async function rejected(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (cause) {
    if (cause instanceof Error) return cause.message;
    throw cause;
  }
  throw new Error("Expected a rejected promise");
}
