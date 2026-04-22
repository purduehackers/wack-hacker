---
name: unit-test-quality
description: Write and review unit tests with strict quality standards. Use when writing new unit tests, reviewing tests in a PR, refactoring a test file, fixing flaky tests, or deciding how to structure test doubles. Enforces — never mock internal modules (use dependency injection instead); only mock third-party SDKs at the package boundary; colocate shared fixtures and fakes under one directory like src/lib/test/ and never duplicate them; test observable behavior, not implementation; no shortcuts (no `as any`, no skipped or todo'd tests, no assertions that only check "did not throw").
license: MIT
metadata:
  author: ray
  version: "1.0.0"
---

# Unit Test Quality

Write unit tests that actually protect the code. A unit test verifies the observable behavior of one module against its contract. Tests that mock their way around the code they claim to cover are worse than no test — they pass when production is broken.

## Principles

- A unit test exercises real code. Use real implementations of internal collaborators whenever they are cheap and deterministic.
- Fakes go at the system boundary (network, disk, time, third-party SDKs), not between your own modules.
- A test failure should point to a specific contract that was broken. If a test can only fail when you update the mocks, it is not testing behavior.
- Shared fixtures live in one place and are imported. Never copy.

## Rule 1 — Only mock third-party SDKs

Mock packages owned by someone else: database clients, API SDKs, message brokers, email senders, HTTP clients. Mock them **at the package boundary** so the production code path under test is untouched.

```ts
// good — mock the SDK package
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pagesRetrieve: vi.fn(),
  pagesUpdate: vi.fn(),
}));

vi.mock("@notionhq/client", () => ({
  Client: notionClientClass({
    pagesRetrieve: mocks.pagesRetrieve,
    pagesUpdate: mocks.pagesUpdate,
  }),
}));
```

`vi.hoisted()` is required because `vi.mock()` is hoisted above imports — the mock references must exist before the mocked package is loaded.

## Rule 2 — Never mock internal modules

No `vi.mock("@/lib/...")`, no `vi.mock("./sibling")`, no `vi.mock("../services/foo")`. Mocking your own code is how tests pass while production breaks: the mock drifts from the real module, silently.

If you feel the need to mock an internal module, the module you are testing needs a **dependency injection seam**: an optional parameter with a sensible default. Production calls it with no argument and gets the real dependency; tests pass a fake.

```ts
// production code — default parameter is the seam
export function buildContextSnapshot(args: {
  userId: string;
  getTools?: typeof getOrchestratorTools; // seam
}): ContextSnapshot {
  const { getTools = getOrchestratorTools } = args;
  const tools = getTools();
  // ...
}

// test — pass a fake, no mocking
test("includes tool names", () => {
  const snapshot = buildContextSnapshot({
    userId: "u1",
    getTools: () => ({ currentTime: tool(...), documentation: tool(...) }),
  });
  expect(snapshot.tools).toContain("currentTime");
});
```

If adding a seam is awkward, the design likely needs it anyway — collaborators should be injectable.

## Rule 3 — Shared fixtures in one place

Put reusable fakes, builders, and fixtures under a single directory. In this repo that is `src/lib/test/`:

```
src/lib/test/
  constants.ts       // shared test constants
  types.ts           // fake/mock type definitions
  fixtures/
    sdks.ts          // class builders for third-party SDKs
    redis.ts         // in-memory Redis with real-semantic get/set/del/sadd
    discord.ts       // message/command context helpers
    ai.ts            // agent/model fakes
    http.ts          // fetch mock
    sandbox.ts       // in-memory sandbox provider
  index.ts           // barrel export
```

Import test utilities from the barrel. Exclude the directory from coverage.

## Rule 4 — No duplication

If two tests need the same fake setup, fake HTTP response, or builder, **extract it to `src/lib/test/`**. Do not copy a mock implementation between files. Do not keep two variants of the same fixture that drift apart.

Before writing a new helper in a test file, grep `src/lib/test/` for an existing one.

## Rule 5 — Colocation and naming

- Unit tests live next to the file they test: `foo.ts` → `foo.test.ts`
- Integration tests use `foo.integration.test.ts` and run in a separate suite
- One `describe` block per public function is usually right; one `test` / `it` per behavior
- `beforeEach(() => vi.clearAllMocks())` when hoisted mocks are used, to prevent cross-test leakage

## Rule 6 — Test behavior, not implementation

Assert on what a caller can observe: return values, thrown errors, state that is later queryable through a public API, calls that went out through mocked boundaries.

Do not assert on private fields, call counts of internal methods, or the order of internal steps unless order is part of the contract.

If the only way to assert what you want is to reach into internals, the module is missing an observable surface — add one (return more structured data, expose a query method) before writing the test.

## Rule 7 — No shortcuts

Each of these is a red flag. Fix the underlying issue instead:

- `as any`, `as unknown as X`, or `@ts-expect-error` to silence type errors — make the types correct
- `.skip`, `.todo`, `.only` committed to main — land green or don't land
- `expect(() => fn()).not.toThrow()` as the only assertion — assert the actual result
- Tests that pass with the implementation commented out — they are testing mocks, not code
- Copy-pasted mock setups — extract to `src/lib/test/`
- `eslint-disable` on test files — the lint rule exists for a reason in tests too

## Review checklist

When writing or reviewing a test file, walk this list:

- [ ] Every `vi.mock(...)` points at a third-party package, not a `@/` or relative path
- [ ] No internal module is mocked; collaborators are injected via seams
- [ ] Shared fakes/fixtures come from `src/lib/test/`, not defined inline or duplicated
- [ ] Each test asserts observable behavior, not implementation details
- [ ] No `as any`, no `.skip` / `.todo`, no `eslint-disable`
- [ ] `beforeEach` clears mock state when hoisted mocks are used
- [ ] Test name reads as a sentence about what the code does
- [ ] Test would fail if the implementation it covers were broken

## When to deviate

Rules above cover unit tests. Integration tests are run through a separate suite and may mock fewer boundaries (real DB, real Redis via a container). End-to-end tests mock even less. The discipline — fakes at the boundary, no internal mocks, shared fixtures in one place — still applies; the boundary just moves.
