import { expect, test } from "bun:test";

import { UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { ButtonStyle, ComponentType } from "discord.js";
import type { RESTPostAPIChannelMessageJSONBody } from "discord.js";
import { z } from "zod";

import { createDiscordRest } from "./discord-rest.ts";
import type { DiscordRest } from "./discord-rest.ts";
import { createRenderer, type RendererProjection } from "./renderer.ts";

const bodySchema = z.object({
  content: z.string().optional(),
  components: z.array(z.unknown()).optional(),
  nonce: z.string().optional(),
  attachments: z.array(z.object({ id: z.string(), filename: z.string() })).optional(),
  allowed_mentions: z
    .object({ parse: z.array(z.string()).optional(), users: z.array(z.string()).optional() })
    .optional(),
});
type Message = { id: string; content: string; components: unknown[]; file?: Uint8Array };

function fixture() {
  const messages = new Map<string, Message>();
  // Simulate Discord retaining nonce deduplication briefly after message deletion.
  const nonces = new Map<string, Message>();
  const writes: { method: string; body?: z.output<typeof bodySchema> }[] = [];
  const order: string[] = [];
  let counter = 10;
  let loseUploadReply = false;
  const rest = createDiscordRest({
    post: async (_endpoint, options) => {
      order.push("post");
      const body = bodySchema.parse(options?.body);
      writes.push({ method: "post", body });
      const duplicate = body.nonce === undefined ? undefined : nonces.get(body.nonce);
      if (duplicate !== undefined) return duplicate;
      counter++;
      const message: Message = {
        id: `1000000000000000${counter}`,
        content: body.content ?? "",
        components: body.components ?? [],
        ...(options?.files?.[0] === undefined
          ? {}
          : { file: z.instanceof(Uint8Array).parse(options.files[0].data) }),
      };
      messages.set(message.id, message);
      if (body.nonce !== undefined) nonces.set(body.nonce, message);
      if (loseUploadReply && options?.files?.[0] !== undefined) {
        loseUploadReply = false;
        throw new Error("Upload acknowledgement lost");
      }
      return message;
    },
    patch: async (route, options) => {
      order.push("patch");
      const body = bodySchema.parse(options?.body);
      writes.push({ method: "patch", body });
      const message = messages.get(route.split("/").at(-1) ?? "");
      if (message === undefined)
        throw new UpstreamError({ service: "discord", status: 404, detail: "Unknown Message" });
      if (body.content !== undefined) message.content = body.content;
      if (body.components !== undefined) message.components = body.components;
      if (body.attachments !== undefined) {
        const file = options?.files?.[0];
        if (file === undefined) delete message.file;
        else message.file = z.instanceof(Uint8Array).parse(file.data);
      }
      if (loseUploadReply && options?.files?.[0] !== undefined) {
        loseUploadReply = false;
        throw new Error("Upload acknowledgement lost");
      }
      return message;
    },
    delete: async (route) => {
      order.push("delete");
      writes.push({ method: "delete" });
      messages.delete(route.split("/").at(-1) ?? "");
      return undefined;
    },
  });
  let durable: RendererProjection = { overflow: [] };
  let owned = true;
  let checkpointFails = false;
  const deps = {
    rest,
    channelId: "100000000000000001",
    sourceMessageId: "100000000000000002",
    checkpoint: async (state: RendererProjection) => {
      order.push("checkpoint");
      if (checkpointFails) return false;
      durable = structuredClone(state);
      return true;
    },
    verifyLease: async () => {
      order.push("verify");
      return owned;
    },
  };
  return {
    deps,
    messages,
    nonces,
    writes,
    order,
    restored: () => structuredClone(durable),
    setOwned: (value: boolean) => {
      owned = value;
    },
    failCheckpoints: (value: boolean) => {
      checkpointFails = value;
    },
    loseNextUploadReply: () => {
      loseUploadReply = true;
    },
  };
}

const controls: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]> = [
  {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "Details",
        custom_id: "wack-work:example:1:details",
      },
    ],
  },
];

test("promotes an existing plain anchor without V2 flags and keeps controls on the anchor", async () => {
  const f = fixture();
  const state: RendererProjection = { overflow: [] };
  const renderer = createRenderer(f.deps, state);
  expect(
    Result.isOk(await renderer.write({ text: "Thinking…", activity: "", terminal: false })),
  ).toBe(true);
  const anchor = state.anchorMessageId;
  expect(
    Result.isOk(
      await renderer.write({
        text: "### Update the event\nWorking",
        activity: "",
        anchorComponents: controls,
        terminal: false,
      }),
    ),
  ).toBe(true);
  expect(state.anchorMessageId).toBe(anchor);
  expect(f.messages.size).toBe(1);
  expect(f.messages.get(anchor ?? "")?.components).toEqual(controls);
  expect(f.writes.every((write) => write.body?.allowed_mentions?.parse?.length === 0)).toBe(true);
});

test("raw child activity stays in the projection without being duplicated publicly", async () => {
  const f = fixture();
  const renderer = createRenderer(f.deps, { overflow: [], workCard: { title: "Research" } });
  await renderer.write({
    text: "Checking the images",
    activity: "",
    subagentActivity: "cms: calling get_media",
    anchorComponents: controls,
    terminal: false,
  });
  expect([...f.messages.values()][0]?.content).toBe("Checking the images");
  expect(f.restored().subagentActivity).toBe("cms: calling get_media");
  expect(f.restored().workCard?.title).toBe("Research");
});

test("HITL gets a new notifying message per request, while anchor mentions stay suppressed", async () => {
  const f = fixture();
  const state: RendererProjection = { overflow: [] };
  const renderer = createRenderer(f.deps, state);
  const frame = {
    text: "### Event\nYour input is needed",
    activity: "",
    anchorComponents: controls,
    components: controls,
    mentionUserIds: ["100000000000000003"],
    terminal: false,
  };
  await renderer.write({
    ...frame,
    notice: "<@100000000000000003> Which image?",
    hitlKey: "first",
  });
  const first = state.hitlMessageId;
  await renderer.write({
    ...frame,
    notice: "<@100000000000000003> Approve the update?",
    hitlKey: "second",
  });
  expect(state.hitlMessageId).not.toBe(first);
  expect(f.messages.get(first ?? "")?.content).toContain("Which image?");
  expect(f.messages.get(first ?? "")?.components).toEqual([]);
  const notifications = f.writes.filter(
    (write) => write.method === "post" && write.body?.allowed_mentions?.users !== undefined,
  );
  expect(notifications).toHaveLength(2);
  expect(notifications[0]?.body?.allowed_mentions).toEqual({ users: ["100000000000000003"] });
  expect(notifications[1]?.body?.nonce).not.toBe(notifications[0]?.body?.nonce);
});

test("streaming recovers a deleted anchor with a fresh, durably stable replacement nonce", async () => {
  const f = fixture();
  const state: RendererProjection = { overflow: [] };
  const renderer = createRenderer(f.deps, state);
  await renderer.write({ text: "Working", activity: "", terminal: false });
  const first = state.anchorMessageId;
  f.messages.delete(first ?? "");
  expect(
    Result.isOk(await renderer.write({ text: "Found the event", activity: "", terminal: false })),
  ).toBe(true);
  expect(state.anchorMessageId).not.toBe(first);
  expect(f.restored().anchorGeneration).toBe(1);
  expect(f.messages.get(state.anchorMessageId ?? "")?.content).toBe("Found the event");
  const nonces = f.writes
    .filter((write) => write.method === "post")
    .map((write) => write.body?.nonce ?? "");
  expect(new Set(nonces).size).toBe(2);
  expect(nonces.every((value) => value.length <= 25)).toBe(true);
});

test("restart after a failed checkpoint converges on one message without duplicate effects", async () => {
  const f = fixture();
  f.failCheckpoints(true);
  const first = createRenderer(f.deps, { overflow: [] });
  expect(
    Result.isError(
      await first.write({
        text: "Response",
        activity: "",
        anchorComponents: controls,
        terminal: true,
      }),
    ),
  ).toBe(true);
  f.failCheckpoints(false);
  const retry = createRenderer(f.deps, f.restored());
  expect(
    Result.isOk(
      await retry.write({
        text: "Response",
        activity: "",
        anchorComponents: controls,
        terminal: true,
      }),
    ),
  ).toBe(true);
  expect(f.messages.size).toBe(1);
  expect([...f.messages.values()][0]?.components).toEqual(controls);
});

test("every mutation is fenced and lost ownership stops before writing", async () => {
  const f = fixture();
  const renderer = createRenderer(f.deps, { overflow: [] });
  await renderer.write({
    text: "Response",
    activity: "",
    anchorComponents: controls,
    terminal: false,
  });
  for (const [index, operation] of f.order.entries()) {
    if (["post", "patch", "delete"].includes(operation)) expect(f.order[index - 1]).toBe("verify");
  }
  f.setOwned(false);
  const count = f.writes.length;
  expect(
    Result.isError(await renderer.write({ text: "New response", activity: "", terminal: true })),
  ).toBe(true);
  expect(f.writes).toHaveLength(count);
});

test("terminal transition retires questions, removes stale overflow and retains Details", async () => {
  const f = fixture();
  const state: RendererProjection = { overflow: [] };
  const renderer = createRenderer(f.deps, state);
  await renderer.write({ text: "old ".repeat(800), activity: "", terminal: true });
  expect(state.overflow.length).toBeGreaterThan(0);
  await renderer.write({
    text: "Waiting",
    activity: "",
    notice: "Question",
    components: controls,
    hitlKey: "question",
    terminal: false,
  });
  const request = state.hitlMessageId;
  await renderer.write({
    text: "Response ready",
    activity: "",
    anchorComponents: controls,
    terminal: true,
  });
  expect(state.overflow).toEqual([]);
  expect(state.hitlMessageId).toBeUndefined();
  expect(f.messages.get(request ?? "")?.components).toEqual([]);
  expect(f.messages.get(state.anchorMessageId ?? "")?.components).toEqual(controls);
});

test("long final answers attach to the canonical card and only upload after streaming ends", async () => {
  const f = fixture();
  const state: RendererProjection = { overflow: [] };
  const renderer = createRenderer(f.deps, state);
  const full = "A complete paragraph.\n".repeat(500);
  const frame = {
    text: "Response preview",
    activity: "",
    anchorComponents: controls,
    resultFile: full,
  };
  await renderer.write({ ...frame, terminal: false });
  expect(f.messages.get(state.anchorMessageId ?? "")?.file).toBeUndefined();
  await renderer.write({ ...frame, terminal: true });
  expect(f.messages.size).toBe(1);
  expect(f.messages.get(state.anchorMessageId ?? "")?.file).toEqual(Buffer.from(full));
  const writes = f.writes.length;
  await renderer.write({ ...frame, terminal: true });
  expect(f.writes).toHaveLength(writes);
  // Same visible preview, a corrected tail: the file participates in the hash.
  await renderer.write({ ...frame, resultFile: `${full}Correction.`, terminal: true });
  expect(f.messages.get(state.anchorMessageId ?? "")?.file).toEqual(
    Buffer.from(`${full}Correction.`),
  );
  await renderer.write({
    text: "Short replacement",
    activity: "",
    anchorComponents: controls,
    terminal: true,
  });
  expect(f.messages.get(state.anchorMessageId ?? "")?.file).toBeUndefined();
  expect(f.writes.at(-1)?.body?.attachments).toEqual([]);
});

test("an upload with a lost acknowledgement retries without creating another card", async () => {
  const f = fixture();
  f.loseNextUploadReply();
  const frame = {
    text: "Preview",
    activity: "",
    anchorComponents: controls,
    resultFile: "Complete answer",
    terminal: true,
  };
  const attempt = createRenderer(f.deps, { overflow: [] });
  expect(Result.isError(await attempt.write(frame))).toBe(true);
  const retry = createRenderer(f.deps, f.restored());
  expect(Result.isOk(await retry.write(frame))).toBe(true);
  expect(f.messages.size).toBe(1);
  expect([...f.messages.values()][0]?.file).toEqual(Buffer.from(frame.resultFile));
});

test("upload success followed by checkpoint failure is recoverable after restart", async () => {
  const f = fixture();
  const renderer = createRenderer(f.deps, { overflow: [] });
  await renderer.write({ text: "Working", activity: "", terminal: false });
  f.failCheckpoints(true);
  const frame = {
    text: "Preview",
    activity: "",
    anchorComponents: controls,
    resultFile: "Complete answer",
    terminal: true,
  };
  expect(Result.isError(await renderer.write(frame))).toBe(true);
  f.failCheckpoints(false);
  expect(Result.isOk(await createRenderer(f.deps, f.restored()).write(frame))).toBe(true);
  expect(f.messages.size).toBe(1);
  expect([...f.messages.values()][0]?.file).toEqual(Buffer.from(frame.resultFile));
});

test("missing attachment permission never checkpoints a final result that Discord did not accept", async () => {
  const f = fixture();
  await createRenderer(f.deps, { overflow: [] }).write({
    text: "Working",
    activity: "",
    terminal: false,
  });
  const before = f.restored();
  const rest = {
    ...f.deps.rest,
    editMessage: async () =>
      Result.err(
        new UpstreamError({ service: "discord", status: 403, detail: "Missing Permissions" }),
      ),
  };
  const result = await createRenderer({ ...f.deps, rest }, f.restored()).write({
    text: "Preview",
    activity: "",
    resultFile: "Full result",
    terminal: true,
  });
  expect(Result.isError(result)).toBe(true);
  expect(f.restored()).toEqual(before);
  expect([...f.messages.values()][0]?.content).toBe("Working");
});

test("attachment rejection falls back to complete durable text without reusing legacy HITL nonces", async () => {
  const f = fixture();
  const forbidden = () =>
    Result.err(
      new UpstreamError({ service: "discord", status: 403, detail: "Missing Attach Files" }),
    );
  let attempts = 0;
  const rest = {
    ...f.deps.rest,
    postMessage: async (...args: Parameters<DiscordRest["postMessage"]>) => {
      if (args[2] === undefined) return f.deps.rest.postMessage(...args);
      attempts++;
      return forbidden();
    },
    editMessage: async (...args: Parameters<DiscordRest["editMessage"]>) => {
      if (args[4] === undefined) return f.deps.rest.editMessage(...args);
      attempts++;
      return forbidden();
    },
  };
  const state: RendererProjection = { overflow: [] };
  const renderer = createRenderer({ ...f.deps, rest }, state);
  // These paragraph sizes force the readable splitter past eight chunks.
  const full = `### Request\nWorking\n\n${("x".repeat(950) + "\n\n").repeat(14)}THE FINAL LINE`;
  const frame = {
    text: "Preview",
    activity: "",
    anchorComponents: controls,
    resultFile: full,
    unclippedText: full,
    terminal: true,
  };
  expect(Result.isOk(await renderer.write(frame))).toBe(true);
  expect(state.textOnlyResult).toBe(true);
  expect([...f.messages.values()].map((message) => message.content).join("")).toBe(full);
  expect(f.messages.size).toBeLessThanOrEqual(8);
  expect(
    [...f.messages.values()].every(
      (message) => message.content.length <= 1_900 && message.file === undefined,
    ),
  ).toBe(true);
  const posted = f.writes
    .filter((write) => write.method === "post")
    .map((write) => write.body?.nonce);
  expect(new Set(posted).size).toBe(posted.length);
  expect(posted).not.toContain(`${f.deps.sourceMessageId}:6`);
  const attempted = attempts;
  expect(Result.isOk(await createRenderer({ ...f.deps, rest }, f.restored()).write(frame))).toBe(
    true,
  );
  expect(attempts).toBe(attempted);
});
