import { UnhandledException } from "better-result";
import { expect, test } from "vitest";

import { InvariantViolated, NotFound } from "../errors.ts";
import { Result } from "./index.ts";
import { instrument, observe } from "./observe.ts";
import type { Reporter, WideEvent } from "./observe.ts";

function recordingReporter(): {
  reporter: Reporter;
  events: WideEvent[];
  defects: unknown[];
} {
  const events: WideEvent[] = [];
  const defects: unknown[] = [];
  return {
    events,
    defects,
    reporter: {
      emit: (wide) => void events.push(wide),
      captureDefect: (error) => void defects.push(error),
    },
  };
}

test("success is not reported by observe", () => {
  const { reporter, events, defects } = recordingReporter();

  observe("chat.turn", reporter, Result.ok(1));

  expect(events).toEqual([]);
  expect(defects).toEqual([]);
});

test("an expected failure is counted but never paged", () => {
  const { reporter, events, defects } = recordingReporter();

  observe("skill.load", reporter, Result.err(new NotFound({ kind: "skill", id: "issues" })));

  expect(defects).toEqual([]);
  expect(events).toEqual([
    {
      op: "skill.load",
      status: "error",
      errorTag: "NotFound",
      errorMessage: "skill not found: issues",
    },
  ]);
});

test("a defect is both counted and paged", () => {
  const { reporter, events, defects } = recordingReporter();

  observe(
    "wire.decode",
    reporter,
    Result.err(new UnhandledException({ cause: new Error("boom") })),
  );

  expect(defects).toHaveLength(1);
  expect(events[0]?.status).toBe("defect");
});

test("a violated invariant is a defect even though it is tagged", () => {
  const { reporter, events, defects } = recordingReporter();

  observe(
    "lease.release",
    reporter,
    Result.err(new InvariantViolated({ invariant: "lease-owner", detail: "token mismatch" })),
  );

  expect(defects).toHaveLength(1);
  expect(events[0]).toMatchObject({ status: "defect", errorTag: "InvariantViolated" });
});

test("observe returns the result untouched so it stays chainable", () => {
  const { reporter } = recordingReporter();
  const failure = new NotFound({ kind: "ship", id: "3" });

  const returned = observe("ship.get", reporter, Result.err<number, NotFound>(failure));

  expect(Result.isError(returned) && returned.error).toBe(failure);
});

test("instrument emits exactly one event with a duration on success", async () => {
  const { reporter, events } = recordingReporter();
  let clock = 1_000;
  const now = () => clock;

  const result = await instrument(
    "task.fire",
    reporter,
    async () => {
      clock += 250;
      return Result.ok("done");
    },
    now,
  );

  expect(Result.isOk(result)).toBe(true);
  expect(events).toEqual([{ op: "task.fire", status: "ok", durationMs: 250 }]);
});

test("instrument emits exactly one event with a duration on failure", async () => {
  const { reporter, events, defects } = recordingReporter();
  let clock = 0;
  const now = () => clock;

  await instrument(
    "task.fire",
    reporter,
    async () => {
      clock += 10;
      return Result.err(new NotFound({ kind: "task", id: "t1" }));
    },
    now,
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ status: "error", errorTag: "NotFound", durationMs: 10 });
  expect(defects).toEqual([]);
});
