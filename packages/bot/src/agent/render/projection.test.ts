import { expect, test } from "bun:test";

import { renderProjectionSchema } from "@repo/shared/conversations";

import { toRendererProjection } from "./renderer.ts";

/**
 * The mapping used to be a hand-written copy of the schema, so a field added to
 * one was silently dropped by the other — which is how an input request's message
 * id stopped reaching the renderer, making every paint post a new question
 * instead of editing the one already on screen.
 */
test("every stored field but the revision reaches the renderer", () => {
  const stored = renderProjectionSchema.parse({
    anchorMessageId: "99999999999999900",
    anchorContentHash: "abcdefghijklmnop",
    hitlMessageId: "99999999999999901",
    hitlContentHash: "qrstuvwxyzabcdef",
    hitlRequestKey: "req-1",
    subagentActivity: "code: reading files",
    overflow: [{ messageId: "99999999999999902" }],
    appliedRevision: 3,
  });

  const projection = toRendererProjection(stored);

  expect(projection.hitlMessageId).toBe("99999999999999901");
  expect(projection.hitlContentHash).toBe("qrstuvwxyzabcdef");
  expect(projection.hitlRequestKey).toBe("req-1");
  expect(projection.subagentActivity).toBe("code: reading files");
  expect(projection.anchorMessageId).toBe("99999999999999900");
  expect(projection.overflow).toEqual([{ messageId: "99999999999999902" }]);
  expect(Object.hasOwn(projection, "appliedRevision")).toBe(false);
});

/** The renderer mutates what it is handed, so it must not share the stored array. */
test("overflow is copied rather than aliased", () => {
  const stored = renderProjectionSchema.parse({ overflow: [], appliedRevision: 0 });
  const projection = toRendererProjection(stored);
  projection.overflow.push({ messageId: "99999999999999903" });
  expect(stored.overflow).toHaveLength(0);
});
