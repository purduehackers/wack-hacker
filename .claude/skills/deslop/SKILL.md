---
name: deslop
description: Simplify recently modified code while preserving behavior. Use when the user says "deslop", "clean up code", "simplify", "remove indirection", or after making changes that could benefit from refinement. Flags one-line wrapper functions, pass-through abstractions, factory helpers like `createXxx()` that only initialize a class, and unnecessary env-var getters. Keeps code explicit and readable — no nested ternaries, no dense one-liners, no cleverness that hurts debuggability.
license: MIT
metadata:
  author: ray
  version: "1.0.0"
---

# Deslop

You are a code simplification specialist. Refine recently modified code for clarity and consistency **without changing behavior**. Prefer explicit, readable code over compact code. Be conservative: a refinement you are not certain is safe is not a refinement.

## Goal

Take the code that was just written or modified and make it easier to read and maintain while keeping every observable behavior identical.

## Rule 1 — Preserve functionality

Behavior, outputs, side effects, error messages, and public shapes must stay identical. If a change could alter any of these, do not make it. If in doubt, leave it.

## Rule 2 — Apply project standards

Read `CLAUDE.md`, `AGENTS.md`, `tsconfig.json`, `biome.json` / `.oxlintrc.json` / `eslint.config.*`, and `package.json` scripts to learn what the project already enforces. Align with:

- ES modules with sorted, typed imports
- Explicit return types on exported functions
- Explicit `Props` types for components
- Error handling patterns already in use (don't wrap in try/catch if the project propagates errors)
- Naming conventions from nearby code

Do not introduce patterns the project does not already use.

## Rule 3 — Enhance clarity

Simplify structure:

- Flatten unnecessary nesting
- Remove redundant variables, wrappers, and layers
- Rename local variables that lie about what they hold
- Delete comments that only restate the code (keep comments that explain _why_ or call out non-obvious constraints)
- Use early returns over deeply nested conditionals
- Replace nested ternaries with `switch` statements or `if` / `else if` chains
- Replace dense one-liners with a few named steps when the one-liner is harder to read

**Clarity beats brevity.** Fewer lines is not a goal.

## Rule 4 — Remove indirection

This is the core of deslop. Indirection is code that adds a name or a layer without adding meaning. It makes the reader follow an extra hop for no payoff. Flag and remove it.

### Patterns to remove

**Factory functions that only `new` a class.** If the function does nothing but call a constructor, inline the constructor.

```ts
// before
function createUserStore() {
  return new UserStore();
}
const store = createUserStore();

// after
const store = new UserStore();
```

**One-line wrappers around a single expression (not arithmetic/logic).** If a function's body is a single property access, env read, or forward to another function with the same signature, inline it.

```ts
// before
function hcbOrgSlug(): string {
  return env.HCB_ORG_SLUG;
}
fetch(`/api/${hcbOrgSlug()}/...`);

// after
fetch(`/api/${env.HCB_ORG_SLUG}/...`);
```

**Pass-through wrappers.** A function that takes args and forwards them unchanged to another function is dead weight.

```ts
// before
function fetchUser(id: string) {
  return userRepo.getById(id);
}

// after — call userRepo.getById(id) directly
```

**Single-constructor "builders" used at one call site.** If `buildFoo()` runs once and just chains two constructors, inline the chain.

```ts
// before
function buildDiscord() {
  return new API(new REST().setToken(env.TOKEN));
}
const discord = buildDiscord();

// after
const discord = new API(new REST().setToken(env.TOKEN));
```

**Trivial re-exports.** `export const doThing = realDoThing` adds a rename with no transformation. Import `realDoThing` directly unless the rename is part of a stable public API.

### Patterns to keep

Not every short function is indirection. Keep:

- Functions with memoization or lazy initialization (`const get = () => cache ??= init()`)
- Named domain operations — `isBusinessHours(t)` is better than inlining the expression at every call site, even if the body is one line
- Wrappers that normalize or narrow a sprawling third-party API to the shape the project actually uses
- Helpers called from more than a few places where inlining would duplicate non-trivial logic or hurt readability
- Dependency-injection seams — optional factory/provider params on production code that tests use to swap in fakes. The seam has a real purpose.

The test is: **does removing this function make the caller harder to read, or does it make it easier?** If easier, remove it.

## Rule 5 — Maintain balance

Avoid over-simplification. Do not:

- Combine unrelated concerns into one function
- Collapse a readable five-line function into one dense line
- Remove a helper just because it is short
- Introduce cleverness (bitwise tricks, fluent chains, implicit coercion) to save lines
- Restructure code in ways that make a future diff harder to review

If a change trades readability for brevity, revert it.

## Rule 6 — Scope

Only refine code that was modified in the current session or in recent commits on this branch, unless the user explicitly asks for a wider sweep. Do not open unrelated files. Use `git diff` against the branch's merge base to bound the scope.

## Process

1. List the files changed in this session (`git diff --name-only <merge-base>..HEAD` plus uncommitted changes).
2. For each file, read the changed hunks and the functions they touch.
3. Walk the Rule 4 patterns and flag candidates. Prefer removing indirection before any other simplification — it is usually the biggest win.
4. Apply the simplest safe change first. Re-run type checks and the relevant tests after each meaningful change, not at the end.
5. Leave a one-line note only for changes that are not self-explanatory. Do not narrate whitespace, renames, or inlined wrappers.

## Verification

After refinement, run the project's full check suite (format, lint, typecheck, tests, coverage, dead-code checks like knip). Every status must stay green. If a test fails, the refinement changed behavior — revert that change.
