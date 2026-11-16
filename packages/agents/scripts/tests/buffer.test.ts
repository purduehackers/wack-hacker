import { describe, expect, test } from "bun:test";

import { PostsInputSchema, editPostArguments } from "../../agent/subagents/buffer/lib/inputs.ts";
import { paginateBuffer } from "../../agent/subagents/buffer/lib/pagination.ts";
import { executeOnce } from "../../agent/subagents/buffer/lib/replay.ts";
import type { MutationJournal } from "../../agent/subagents/buffer/lib/replay.ts";
import {
  assertOrganizationScope,
  mutationErrors,
} from "../../agent/subagents/buffer/lib/results.ts";
import type { BufferResult } from "../../agent/subagents/buffer/lib/results.ts";
import { bufferSchema, operationDocument } from "../../agent/subagents/buffer/lib/schema.ts";

const success: BufferResult = {
  ok: true,
  operation: "createPost",
  data: { __typename: "PostActionSuccess", post: { id: "saved" } },
  errors: [],
};
function journal() {
  let record: Awaited<ReturnType<MutationJournal["previous"]>>;
  return {
    start: async () => {
      if (record) return false;
      // oxlint-disable-next-line unicorn/no-null -- persisted unfinished operation has a null result
      record = { inputHash: "same-input", status: "started", result: null };
      return true;
    },
    previous: async () => record,
    finish: async (value: BufferResult) => {
      record = { inputHash: "same-input", status: "completed", result: JSON.stringify(value) };
    },
  } satisfies MutationJournal;
}

describe("Buffer contract and boundaries", () => {
  test("every public operation has a valid default GraphQL document", () => {
    let count = 0;
    for (const root of [bufferSchema.getQueryType(), bufferSchema.getMutationType()]) {
      for (const field of Object.values(root?.getFields() ?? {})) {
        const variables = Object.fromEntries(field.args.map((arg) => [arg.name, {}]));
        expect(operationDocument(field.name, variables).document).toContain(field.name);
        count += 1;
      }
    }
    expect(count).toBe(49);
  });
  test("rejects selections that escape their root or reference unknown fields", () => {
    expect(() =>
      operationDocument("account", {}, 'id } channels(input: {organizationId: "foreign"}) { id'),
    ).toThrow();
    expect(() => operationDocument("account", {}, "nonexistentField")).toThrow();
  });
  test("ID-only operations cannot use a key with unconfigured memberships", () => {
    expect(() => assertOrganizationScope(["permitted"], ["permitted"])).not.toThrow();
    expect(() => assertOrganizationScope(["permitted", "foreign"], ["permitted"])).toThrow();
    expect(() => assertOrganizationScope([], ["permitted"])).toThrow();
  });
  test("preserves explicit null while omitted fields stay omitted", () => {
    const absent = PostsInputSchema.parse({ organizationId: "org" });
    const cleared = PostsInputSchema.parse(JSON.parse('{"organizationId":"org","filter":null}'));
    expect(Object.hasOwn(absent, "filter")).toBe(false);
    expect(cleared.filter).toBeNull();
    expect(editPostArguments.safeParse({ input: { id: "post", imaginary: true } }).success).toBe(
      false,
    );
  });
  test("finds partial failure unions even under an otherwise successful payload", () => {
    expect(
      mutationErrors({
        __typename: "PromotionSuccess",
        posts: [{ id: "saved" }],
        failures: [{ __typename: "PostInvalidInputError", message: "Missing channel" }],
      }),
    ).toEqual(["Missing channel"]);
  });
});

describe("mutation replay", () => {
  test("a completed retry returns its saved result without executing", async () => {
    const store = journal();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return success;
    };
    expect(await executeOnce("same-input", store, run)).toEqual(success);
    expect(await executeOnce("same-input", store, run)).toEqual(success);
    expect(calls).toBe(1);
    expect(await rejected(executeOnce("changed", store, run))).toContain("input changed");
  });
  test("lost mutation response never automatically repeats the write", async () => {
    const store = journal();
    let calls = 0;
    const lost = async () => {
      calls += 1;
      throw new Error("timeout after upstream accepted");
    };
    expect(await rejected(executeOnce("same-input", store, lost))).toContain("timeout");
    expect(await rejected(executeOnce("same-input", store, lost))).toContain("uncertain");
    expect(calls).toBe(1);
  });
});

describe("pagination", () => {
  const page = (more: boolean, cursor: string): BufferResult => ({
    ok: true,
    operation: "posts",
    data: { edges: [{ node: { id: cursor } }], pageInfo: { hasNextPage: more, endCursor: cursor } },
    errors: [],
  });
  test("bounds traversal and exposes incomplete datasets", async () => {
    const result = await paginateBuffer({}, 1, async () => page(true, "next"));
    expect(result.complete).toBe(false);
    const done = await paginateBuffer({}, 3, async (input) =>
      page(input.after === undefined, input.after ? "last" : "next"),
    );
    expect(done.complete).toBe(true);
    expect(done.pages.length).toBe(2);
  });
  test("stops cyclic cursors and marks upstream errors incomplete", async () => {
    expect(await rejected(paginateBuffer({}, 3, async () => page(true, "stuck")))).toContain(
      "did not advance",
    );
    const failed = await paginateBuffer({}, 3, async () => ({
      ...success,
      ok: false,
      errors: ["denied"],
    }));
    expect(failed.complete).toBe(false);
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
