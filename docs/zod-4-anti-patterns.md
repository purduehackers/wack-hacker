# Zod 4 Anti-Pattern Catalog — `wack-hacker`

**Repo:** `/Users/ray/Projects/play/wack-hacker` · **zod 4.4.3** (verified: `node_modules/zod/package.json` resolves 4.4.3 for all three packages; `z.core.version` matches)
**Audience:** the engineer authoring `oxray` lint rules to keep these patterns from coming back.
**Line numbers** were accurate when the audits ran; files have moved since (`agent/env.ts`,
`check-capabilities.ts`, `utils/dates.ts`, `utils/conversation/`). Paths are current, individual
line numbers may have drifted — locate by the quoted code, not the line.
**Provenance:** seven parallel audits, each of which _executed_ its library claims against this repo's own zod rather than recalling them. Where audits disagreed, both numbers are printed.

---

## Read this before you write a single rule

Six library facts that contradict widely-held (zod-3-era) knowledge — including two that contradict the canonical zod-4 reference sheet. A rule built on the wrong one of these will cause an outage.

| Claim you probably believe                                               | What 4.4.3 actually does                                                                                                                                                                                      | Consequence for a rule                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.extend()` throws on a schema carrying refinements; use `.safeExtend()` | **False.** `.extend()` does not throw and _preserves_ the refinement. `.safeExtend()` is runtime-identical — it differs only in its `SafeExtendShape` type constraint. Verified independently by two audits.  | An `.extend()` → `.safeExtend()` rule is a **no-op**. Do not write it.                                                                                   |
| Prefer shape-spread over `.extend()` when merging                        | **Actively unsafe.** `z.strictObject({...base.shape, x})` silently drops `base`'s `.superRefine`; `base.extend({x})` keeps it. `.shape` still returns the keys, so the rewrite type-checks and looks correct. | The spread rule must **refuse** when the receiver's declaration contains `.refine(` / `.superRefine(` / `.check(`. See `shape-spread-drops-refinements`. |
| A failed format check stops the chain                                    | **False.** Format issues are pushed with `continue: !def.abort`, so a following `.refine` still runs on the invalid string. Only `invalid_type` aborts.                                                       | This is the root of the repo's three live crashes. `abort: true` (verified) is the fix.                                                                  |
| `z.httpUrl()` is a drop-in for `z.string().url()`                        | **No.** It pins `hostname` to `z.regexes.domain`, rejecting `http://localhost:8080` and `http://127.0.0.1:3000`. `.env.example:33` ships `BOT_URL=http://127.0.0.1:8080`.                                     | Never autofix `.url()` → `z.httpUrl()`. Use `z.url({ protocol: /^https?$/u })`.                                                                          |
| `z.nanoid()` / `z.hash("sha256")` match the obvious regex                | `z.core.regexes.nanoid` is **21** chars (repo ids are 22). `z.core.regexes.sha256_hex` is `[0-9a-fA-F]` — **case-insensitive** (repo digests are lowercase-only).                                             | `builtin-format-lookalike-regex` is a **negative** rule. Non-autofixable.                                                                                |
| `z.discriminatedUnion` honors `.default()` on the discriminant           | **No.** Omitting a defaulted discriminant yields `invalid_union` / "No matching discriminator".                                                                                                               | Blocks 2 of 6 DU conversions outright (`guild.ts:126`, `messages.ts:463`).                                                                               |

Two more, cheaper but load-bearing:

- **`.exclude()` / `.extract()` take entry KEYS, not values.** On an object-derived enum that means `.exclude(["Public"])`, not `.exclude(["public"])` — the wrong one throws `Error: Key public not found in enum` at **module load**. Array-derived enums have key === value, so switching `z.enum([...])` → `z.enum(Obj)` silently changes what these methods expect.
- **`z.base64()` cannot be a `z.templateLiteral` part in 4.4.3.** Its format regex permits `""` via a top-level `^$|` alternative, so anchor-stripping yields an alternation: `z.templateLiteral(["x", z.base64()])` rejects `"xaGk="` and accepts `"aGk="`. Any templateLiteral rule must exclude parts whose pattern has a top-level `|`.
- **`z.json()` is recursive.** `z.toJSONSchema` emits a self-referencing `$defs`/`$ref` for it, in every target and every `reused` mode — inlining cannot remove a genuine cycle. It also **stack-overflows on cyclic input** (a thrown `RangeError`, which `.catch()` does _not_ intercept).

**Where the canonical forms now live** (created by the migration):

| Module                                     | Exports                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `packages/shared/src/formats.ts`           | `discordSnowflake`, `traceparent`, `shortId`, `contentHash`, `digestPinnedImage`, `vcrDigestImage` |
| `packages/shared/src/json.ts`              | `jsonCodec(schema)`, `jsonText`, `stored(schema)`                                                  |
| `packages/shared/src/env/scripts.ts`       | `redisEnv()`, `tursoEnv()`                                                                         |
| `packages/agents/agent/lib/core/schema.ts` | `discordSnowflake`, `jsonCodec`, `storedJson`, `stringToInt`, `storedInt`                          |

⚠ **Residual duplication, verified just now:** `z.stringFormat("discord-snowflake", /^\d{17,20}$/u)` is declared **three times** — `packages/shared/src/formats.ts:21`, `packages/agents/agent/lib/core/schema.ts:15`, `packages/agents/agent/subagents/discord/lib/operations/common.ts:25`. `jsonCodec` is declared twice (`shared/src/json.ts:16`, `agents/lib/core/schema.ts:32`). The duplicate-RegExp-source rule below catches the first; it should be the rule you ship first.

**Legend — Risk:** `inert` = accepted set provably unchanged · `validation` = accepted set changes · `model-schema` = JSON Schema the model reads changes · `judgment` = needs a per-site decision.
**Legend — Status:** what the migration actually did, not what the rule should do.

---

## 1. Summary table

|   # | Pattern                                       | Wrong → right                                                                  |           Sites | Risk         | Status                       |
| --: | --------------------------------------------- | ------------------------------------------------------------------------------ | --------------: | ------------ | ---------------------------- |
|   1 | `tool-input-not-strict`                       | `input: z.object({…})` → `z.strictObject({…})`                                 |             590 | validation   | Applied                      |
|   2 | `optional-instead-of-exactoptional`           | `.optional()` + `...(x===undefined?{}:{x})` → `.exactOptional()` + rest spread |             332 | validation   | Partial (sentry ~40 skipped) |
|   3 | `tool-input-integer-as-number`                | `z.number()` on an id/count → `z.int()`                                        |             186 | model-schema | Applied                      |
|   4 | `min1-accepts-whitespace`                     | `z.string().min(1)` → `.trim().min(1)`                                         |              80 | validation   | Partial                      |
|   5 | `number-int-method`                           | `z.number().int()` → `z.int()`                                                 |              59 | inert        | Applied                      |
|   6 | `inline-id-union-not-shared`                  | 45× inline `z.union([z.string(),z.number()])` → one export                     |              45 | inert        | Applied                      |
|   7 | `zinfer-instead-of-zoutput`                   | `z.infer<T>` → `z.output<T>`                                                   |              41 | inert        | Applied                      |
|   8 | `unbranded-redis-key-ids`                     | `(k: string) => string` → `.brand<"…">()`                                      |              34 | inert        | **Not applied**              |
|   9 | `iso-timestamp-as-bare-string`                | `z.string().describe("ISO…")` → `z.iso.date()/.datetime()`                     |              32 | model-schema | Partial                      |
|  10 | `object-strict-method`                        | `z.object({…}).strict()` → `z.strictObject({…})`                               |              22 | inert        | Applied                      |
|  11 | `named-format-as-bare-regex`                  | `.regex(re, "msg")` → `z.stringFormat("name", re)`                             |              19 | inert        | Applied                      |
|  12 | `repeated-tool-input-shape`                   | 4+ byte-identical inline shapes → one shared const                             |              18 | inert        | Applied                      |
|  13 | `zod3-string-format-method`                   | `z.string().url()` → `z.url()`                                                 |              16 | inert        | Applied                      |
|  14 | `update-schema-hand-redeclared`               | retyped update input → `{id, ...create.partial().shape}`                       |              16 | model-schema | Applied                      |
|  15 | `bare-string-url-on-tool-input`               | `url: z.string()` → `z.url()`                                                  |              14 | model-schema | Applied                      |
|  16 | `throwing-parse-on-provider-response`         | `schema.parse(await res.json())` → safeParse + 502                             |              13 | inert        | Applied                      |
|  17 | `owned-store-ids-as-bare-string`              | our own Drizzle row `id: z.string()` → `z.uuid()` etc.                         |              11 | validation   | Partial                      |
|  18 | `looseobject-parse-as-field-cast`             | `z.looseObject({f}).parse(x)` → `+ .catch(undefined)`                          |              10 | validation   | Applied                      |
|  19 | `record-string-unknown`                       | `z.record(z.string(), z.unknown())` → `z.json()` value                         |              10 | validation   | Applied ⚠ `$ref`             |
|  20 | `enum-member-list-instead-of-enum-object`     | `z.enum([X.A,X.B])` → `z.enum(X)`                                              |               9 | inert        | Applied                      |
|  21 | `optional-default-redundant`                  | `.optional().default(v)` → `.default(v)`                                       |               8 | inert        | Applied                      |
|  22 | `discarded-zod-error-detail`                  | fixed string / `issues.map(i=>i.message)` → `z.prettifyError`                  |               8 | inert        | Applied                      |
|  23 | `unconstrained-url-for-http-endpoint`         | `z.url()` → `z.url({ protocol: /^https?$/u })`                                 |               8 | validation   | Applied                      |
|  24 | `redis-dual-shape-json-decoder`               | `typeof raw==="string"?JSON.parse(raw):raw` → `stored(schema)`                 |             6–7 | inert        | Applied                      |
|  25 | `hand-rolled-required-env-guard`              | `if (!process.env.X) throw` → one `.parse(process.env)`                        |               7 | judgment     | Applied 6/7                  |
|  26 | `union-of-literals-to-literal-array`          | `z.union([z.literal(1),…])` → `z.literal([1,2,3])`                             |               7 | model-schema | Applied                      |
|  27 | `duplicated-discord-snowflake-regex`          | 6 copies of `/^\d{17,20}$/` → one `z.stringFormat`                             |               7 | inert        | Partial (6→3)                |
|  28 | `zodtype-t-generic-helper`                    | `<T>(s: z.ZodType<T>): T` → `<S extends z.ZodType>(s: S): z.output<S>`         |               7 | inert        | Applied                      |
|  29 | `superrefine-emulating-discriminated-union`   | tag + `.superRefine` → `z.discriminatedUnion`                                  |     6 (3 clean) | judgment     | Partial, 2 blocked           |
|  30 | `handrolled-predicate-instead-of-schema`      | `typeof`/`Reflect.get` ladder → a schema                                       |               6 | inert        | Applied                      |
|  31 | `safeparse-success-as-boolean-predicate`      | `x is T` guard + re-read raw value → read `parsed.data`                        |               6 | inert        | Applied                      |
|  32 | `iso-string-to-date-by-hand`                  | `new Date(field)` at the boundary → `z.codec`                                  | 6 (+2 clusters) | judgment     | **Blocked**                  |
|  33 | `int-enum-as-bare-number`                     | `z.number().describe("0=None,1=…")` → `z.literal([0,1,…])`                     |               6 | model-schema | Applied                      |
|  34 | `parse-as-type-cast`                          | `z.record(z.string(),z.unknown()).parse(x)` → a real projection                |               6 | inert        | Partial                      |
|  35 | `stringified-boolean-enum`                    | `z.enum(["true","false"]).transform(…)` → `z.stringbool({…})`                  |      6 (1 real) | validation   | Applied ×1                   |
|  36 | `builtin-format-lookalike-regex`              | **NEGATIVE:** do _not_ swap in `z.nanoid()`/`z.hash()`                         |               6 | validation   | n/a                          |
|  37 | `shape-spread-drops-refinements`              | **NEGATIVE:** keep `.extend()` on a refined base                               |               5 | judgment     | n/a                          |
|  38 | `template-literal-type-as-bare-string`        | prefix regex → `z.templateLiteral([...])`                                      |               5 | validation   | Partial (2)                  |
|  39 | `cross-field-issue-without-path`              | `ctx.addIssue({code,message})` → add `path`                                    |               4 | inert        | Applied                      |
|  40 | `hand-copied-enum-value-list`                 | retyped enum values → `z.enum(X).exclude([...])`                               |               4 | inert        | Applied                      |
|  41 | `json-parse-argument-of-safeparse`            | `schema.safeParse(JSON.parse(x))` → `jsonCodec(schema).safeParse(x)`           |               4 | inert        | Applied                      |
|  42 | `duplicated-app-id-regex`                     | 3× `/^[A-Za-z0-9_-]{22}$/` → one named format                                  |               4 | inert        | Applied                      |
|  43 | `duplicated-image-digest-regex`               | 3 copies, 2 unanchored → one `z.stringFormat`                                  |               4 | validation   | Partial                      |
|  44 | `argv-regex-test-outside-zod`                 | `RE.test(argv)` + throw → schema `.parse()`                                    |               4 | inert        | Applied                      |
|  45 | `sentry-sample-rate-hand-parse`               | `Number(env) + Number.isFinite` → schema `.catch()`                            |               4 | validation   | Applied                      |
|  46 | `date-parse-on-already-validated-iso`         | `Date.parse(validatedField)` → `.transform(s=>new Date(s))`                    |               4 | inert        | Partial                      |
|  47 | `handwritten-type-parallel-to-schema`         | hand type + separate schema → `z.output<typeof s>`                             |               4 | inert        | Applied                      |
|  48 | `manual-exact-optional-spread-transform`      | `.transform(v=>({...(x===undefined?{}:{x})}))` → `.exactOptional()`            |               4 | inert        | Applied                      |
|  49 | `throwing-url-refine`                         | `.url().refine(v=>new URL(v))` → `abort:true`                                  |           **3** | validation   | Applied — **live bug**       |
|  50 | `json-roundtrip-without-codec`                | hand `JSON.stringify` + hand decoder → `jsonCodec`                             |               3 | inert        | Applied                      |
|  51 | `literal-set-instead-of-enum`                 | `ReadonlySet<T>` + `contains()` → `z.enum([...])`                              |  3 (70 members) | judgment     | Applied                      |
|  52 | `zodtype-annotation-instead-of-satisfies`     | `const s: z.ZodType<T> =` → `= … satisfies z.ZodType<T>`                       |               3 | inert        | Applied                      |
|  53 | `dead-guard-after-parse`                      | `if (!Array.isArray(parsed))` → delete                                         |               3 | inert        | Applied                      |
|  54 | `coerce-number-for-env`                       | `z.coerce.number()` → string-regex codec                                       |               2 | validation   | Applied                      |
|  55 | `nested-response-shape-redeclared`            | superset schema retyped → spread a shared shape                                |               2 | inert        | Applied                      |
|  56 | `optional-then-nullish-coalesce-in-transform` | `.optional()` + `?? false` → `.default(false)`                                 |               2 | inert        | Applied                      |
|  57 | `double-tool-input-validation`                | re-`safeParse` what the AI SDK already parsed → delete                         |   1 (659 tools) | inert        | **Not applied**              |
|  58 | `disjoint-key-object-union-to-xor`            | `z.union` of disjoint objects → `z.xor` of strict objects                      |               1 | validation   | Applied — **silent bug**     |
|  59 | `hand-rolled-uuid-regex`                      | transcribed UUID regex → `z.uuid()`                                            |               1 | validation   | Applied                      |
|  60 | `refine-integer-predicate`                    | `.refine(Number.isInteger)` → `z.int()`                                        |               1 | validation   | Applied                      |
|  61 | `string-shape-refine-not-named-format`        | `.refine(v=>!v.includes("\n"))` → `z.stringFormat`                             |               1 | validation   | Applied                      |
|  62 | `bare-string-email-on-tool-input`             | `email: z.string()` → `z.email()`                                              |               1 | model-schema | Applied                      |
|  63 | `object-union-with-shared-literal-key`        | `z.union` keyed on `ok` → `z.discriminatedUnion("ok")`                         |               1 | inert        | Applied                      |
|  64 | `refine-duplicated-by-runtime-guard`          | same condition in `input` refine and `execute` → delete the dead one           |               1 | inert        | Applied                      |
|  65 | `omit-extend-instead-of-spread`               | `.omit().extend()` → `z.strictObject({...omit().shape, …})`                    |               1 | inert        | Applied                      |

**Confirmed absent — do not write these rules.** AST-scanned across all 386 package TS files: `.passthrough()` 0 · `.finite()` 0 · `Number.isFinite` in a zod chain 0 · `.multipleOf`/`.step` 0 · `.gt`/`.gte`/`.negative`/`.nonpositive` 0 · `z.intersection()` 0 · `.and()` 0 · `.merge()` 0 · `.catchall()` 0 · `.brand()` 0 · `.readonly()` 0 (pre-migration) · `.keyof()` 0 · `.pick()` 0 · `.required()` 0 · `.safeExtend()` 0 · `z.nativeEnum` 0 · `z.ZodTypeAny` 0 · `z.core.$ZodType` 0 · `z.prefault` 0 · `z.preprocess` 0. `.prefault` has **zero candidates**: there is no `.trim()`/`.toLowerCase()` followed by `.default()` anywhere, so the default-vs-prefault distinction never arises here.

---

## 2. Patterns

Sections are grouped by family; the table above is the index.

---

## A. String formats and named formats

### `throwing-url-refine` — 3 sites · validation · **live crash, highest severity**

**Wrong** — `packages/agents/agent/subagents/discord/lib/operations/common.ts:30`:

```ts
export const httpUrl = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const parsed = new URL(value); // throws when .url() already failed
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  }, "expected an HTTP(S) URL without embedded credentials");
```

**Right:**

```ts
export const httpUrl = z
  .url({ protocol: /^https?$/u, abort: true })
  .max(2_048)
  .refine((value) => {
    const parsed = new URL(value); // unreachable unless the URL parsed
    return parsed.username === "" && parsed.password === "";
  }, "expected an HTTP(S) URL without embedded credentials");
```

**Buys:** zod pushes format issues with `continue: !def.abort`, so the refine runs on a string `.url()` already rejected and `new URL("not a url")` throws a raw `TypeError` **straight out of `safeParse`**. Confirmed by executing the exact repo schemas: `httpUrl.safeParse("not a url")`, `""`, `"http://"` all threw. That defeats two contracts — `wire.ts:392 decode()` uses `safeParse` specifically to return a `Result` instead of throwing, and `httpUrl` backs 8 model-facing Discord tool-input fields where a malformed model URL should be a retryable validation error, not an unhandled TypeError.
**Sites:** `packages/agents/agent/subagents/discord/lib/operations/common.ts:30` (8 downstream fields: `assets.ts:152,236,331,354`; `guild.ts:129,507`; `roles-channels.ts:136,180`) · `packages/shared/src/wire.ts:200` (`privateAuthorizationUrl`, agent→bot render-intent decode) · `packages/shared/src/bot/generation.ts:10` (`healthUrlSchema`, Redis fenced-generation decode).
**Inert?** No. A 12-input differential showed exactly two rows change: `"notaurl"` THROW→reject (the fix), and `"http:example.com"` accept→reject (a protocol-regex whose `.source` equals `z.regexes.httpProtocol.source` activates zod's `://` guard — that string has no host and resolves as a relative path). Everything else byte-identical, including `http://localhost:8080/x` and `https://1.2.3.4/p`.
**Detection:** `NewExpression new URL(<ident>)` anywhere in the function body passed as arg0 to `.refine`/`.superRefine`/`.check`, where the receiver chain contains a string-format check (`z.url(…)`, `z.string().url()`, `z.httpUrl()`) **without** `abort: true`. Cheaper and broader: **any** `new URL(…)` / `JSON.parse(…)` / `new RegExp(…)` / `BigInt(…)` / `decodeURIComponent(…)` inside a `.refine` callback that is not inside a `TryStatement` — the docs are explicit that a refine must not throw.
**Must not flag:** `z.stringFormat("name", predicate)` where the `new URL` is inside the predicate's own `try/catch`. `z.stringFormat` does **not** wrap the predicate for you (verified), so the try/catch is load-bearing and correct.

### `zod3-string-format-method` — 16 sites · inert

**Wrong:** `z.string().url()` — `packages/bot/src/env.ts:31,37,65`; `packages/agents/agent/env.ts:27,36,39,44,83`; `packages/shared/src/wire.ts:84,202`; `lib/core/subagent-output.ts:13`; `lib/core/web-search.ts:55`; `vercel/lib/edge.ts:321,338`; `cms/lib/media.ts:90`; `discord/lib/operations/common.ts:32`.
**Right:** `z.url()`.
**Buys:** provably identical in 4.4.3 — same accept set (both accept `mailto:`, `foo://`, both trim) and the same JSON Schema `{"type":"string","format":"uri"}`. The method carries `@deprecated` JSDoc at `zod/v4/classic/schemas.d.cts:113`, so the rule has a first-class signal. It is the free win that unblocks `unconstrained-url-for-http-endpoint`.
**Note:** `.email()` (16 sites) and `.datetime()` (6 sites) are **already canonical repo-wide**; `.url()` was the only zod-3 method left. Write the rule for the whole family anyway (`.email/.uuid/.datetime/.jwt/.nanoid/.base64/.emoji/.guid/.cuid2/.ulid/.ip/.e164`) so the next one is caught.
**Detection:** `CallExpression` whose callee is a `MemberExpression` with one of those property names and whose object resolves to a `z.string()` `CallExpression`, directly or through ZodString-returning links. In this repo none of the 16 have `.min`/`.max`/`.trim` before the format method, so `object.callee.object.name === 'z' && object.callee.property.name === 'string'` catches all 16.
**Must not flag:** `.max()` / `.min()` _after_ the format call — those are ZodString methods and stay.

### `named-format-as-bare-regex` — 19 sites · inert

**Wrong** — `packages/agents/agent/subagents/discord/lib/operations/roles-channels.ts:56`:

```ts
const hexColor = z.string().regex(/^#[0-9A-F]{6}$/iu, "expected a six-digit hex color");
```

**Right:**

```ts
const hexColor = z.stringFormat("hex-color", /^#[0-9A-F]{6}$/iu);
```

**Buys:** measured issue payloads. `.regex()` yields `{code:"invalid_format", format:"regex", pattern:"/^#[0-9A-F]{6}$/", message:"Invalid string: must match pattern …"}` — the format is the useless literal `"regex"` and the default message leaks the raw pattern to consumers. `z.stringFormat` yields `{code:"invalid_format", format:"hex-color"}`. Verified via `z.toJSONSchema`: `.regex()` emits only `{type:"string", pattern}` while `z.stringFormat` emits `{type:"string", format:"hex-color", pattern}` — on model-facing tool inputs that is strictly more information at zero validation cost, since `z.stringFormat` with a regex tests the identical pattern.
**Sites (all 19):** `wire.ts:40,44,100,194,327` · `conversations/render.ts:21,25,31` · `discord/lib/operations/common.ts:28`, `guild.ts:65,618`, `assets.ts:151,181`, `roles-channels.ts:56` · `code/tools/code_task.ts:14,17` · `agents/agent/env.ts:78` · `agents/scripts/check-capabilities.ts:23` · `shared/src/bot/generation.ts:28`.
**Inert?** Yes when the RegExp literal is preserved byte-for-byte. 10 of the 19 lacked the `/u` flag; adding it is provably inert on these specific patterns (tested ASCII, Arabic-Indic and mathematical-bold digits against `/^\d{17,20}$/` with and without `u` — identical results).
**Detection:** `.regex(pattern, messageLiteral)` on a `z.string()` chain where a message argument **is** present (the message proves the pattern has a name), OR where the schema is assigned to a `const` whose identifier is not `pattern`/`re`/`regex`. Secondary signal: source begins `^` and ends `$` (a whole-value format, not a substring search). Also flag any `.regex()` RegExp whose flags lack `u`.
**Must not flag:** unanchored substring searches used for text scraping — `packages/shared/scripts/release-check.ts` scans multi-line `docker buildx imagetools inspect` stdout for `Digest:`/`Platform:` lines; those are not value validation and a schema cannot express them.

### `duplicated-discord-snowflake-regex` — 7 sites · inert · **partially fixed, still 3 copies**

**Wrong:** `/^\d{17,20}$/` declared independently in `packages/shared/src/wire.ts:40` (no `/u`), `conversations/render.ts:25` and `:31` (no `/u`), `agents/agent/channels/discord.ts:207` (no `/u`, raw `.test` at `:211`), `lib/schedule/owner.ts:19`, `discord/lib/operations/common.ts:25`; plus the prefixed variant `/^k:\d{17,20}$/` at `conversations/keys.ts:40`, paired with a literal `typeof member !== "string"`.
**Right:** one `z.stringFormat("discord-snowflake", /^\d{17,20}$/u)`, and at the non-zod call sites `snowflake.safeParse(value).success`.
**Buys:** a named `format: "discord-snowflake"` in both the JSON Schema the model sees and the issue payload, instead of the vague `{format:"regex", pattern:"/^\\d{17,20}$/"}`. It also collapses two raw-regex `.test()` guards into schema calls, which is the shape `rayhanadev/no-typeof` and `no-type-erasure` want.
**Current state (verified by grep):** down from 6 declarations to **3**, but they are now three _package-level_ copies of the identical named format — `shared/src/formats.ts:21`, `agents/lib/core/schema.ts:15`, `discord/lib/operations/common.ts:25`. Two agents each built a "shared" module. The rule below still fires, correctly.
**Detection:** build a frequency map of RegExp-literal `.source` strings across the repo (normalize flags before comparing) and flag every source with count > 1 that is not imported from a single module. The same engine covers `duplicated-app-id-regex` and `duplicated-image-digest-regex`. Extend it to `z.stringFormat` _name_ strings, which would have caught the triplication above.

### `duplicated-app-id-regex` — 4 sites · inert

**Wrong:** `z.string().regex(/^[A-Za-z0-9_-]{22}$/)` ×3 with **no message at all** (`wire.ts:100` occurrenceId, `wire.ts:194` renderAuthorization.id, `wire.ts:327` occurrenceId) and `/^[A-Za-z0-9_-]{16}$/` ×1 (`conversations/render.ts:21` contentHash).
**Right:** `z.stringFormat("occurrence-id", /^[A-Za-z0-9_-]{22}$/u)` / `z.stringFormat("content-hash", …)` in one module.
**Buys:** these are the app's own base64url digest ids — produced by `createHash("sha256").…digest("base64url").slice(0,16)` at `bot/src/agent/render/renderer.ts:74` and `.digest("base64url")` truncations at `agents/agent/channels/discord.ts:233-235`. With no message argument, a bad value reports only `{format:"regex"}`.
**Detection:** two or more RegExp literals sharing a normalized `.source` across files where at least one appears as the **sole** argument to `.regex()`. Report the duplicate group, not the sites.
**Must not flag / must not autofix:** `z.nanoid()`. Verified: it pins **21** chars and rejects a 22-char id. See `builtin-format-lookalike-regex`.

### `duplicated-image-digest-regex` — 4 sites · validation

**Wrong:** `z.string().regex(/@sha256:[a-f0-9]{64}$/u)` at `packages/shared/src/bot/generation.ts:28` and `packages/agents/agent/env.ts:78`; a third, _strict and anchored_, non-zod copy `IMAGE_PATTERN` at `packages/shared/scripts/release-check.ts:8`; extracted a fourth time by hand at `packages/agents/agent/lib/bot/supervisor.ts:342`. Plus a bare 64-hex digest at `packages/agents/scripts/check-capabilities.ts:23`.
**Right:** one `z.stringFormat("digest-pinned-image", …)`; for the bare digest, `z.stringFormat("sha256-lower-hex", /^[0-9a-f]{64}$/u)`.
**Buys:** this is the mutable-tag guard for the bot Sandbox image — the one place a drifting copy actually matters. The two zod copies have **no leading `^`**, so they accept `anything-at-all@sha256:<hex>`, `VCR.VERCEL.COM/BOT@sha256:<hex>` and a bare `@sha256:<hex>`. The comment on `env.ts:78` claims "Mutable tags are rejected" — true — but the registry is not constrained at all, so a typo'd or hostile registry host passes boot validation and gets pulled into a Sandbox. `release-check.ts:8` already holds the correct anchored, `vcr.vercel.com`-scoped pattern; it just lives as a bare RegExp behind a manual `.test()`.
**Detection:** (a) duplicate normalized RegExp `.source` across files; (b) **any `.regex()` whose RegExp contains `$` but does not start with `^`** — an unanchored tail match, almost always a bug.
**Do not autofix to `z.hash("sha256")`:** it is `/^[0-9a-fA-F]{64}$/`, case-**insensitive**, where these are lowercase-only. On a supply-chain image pin that is a security regression.

### `builtin-format-lookalike-regex` — 6 sites · **NEGATIVE rule, non-autofixable**

These are the sites a mechanical "use the built-in format" migration will silently break. The rule exists to _prevent_ a fix.

| Site                                                        | Regex                      | Looks like         | Why the swap breaks                                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/wire.ts:100,194,327`                            | `/^[A-Za-z0-9_-]{22}$/`    | `z.nanoid()`       | `z.core.regexes.nanoid` is `{21}`. `z.nanoid().safeParse(<22-char id>)` → `success:false`. Would reject every existing occurrenceId and authorization id in Redis and on the wire. |
| `agents/scripts/check-capabilities.ts:23`                   | `/^[0-9a-f]{64}$/u`        | `z.hash("sha256")` | zod's is `[0-9a-fA-F]`. Widens to accept uppercase hex we never write.                                                                                                             |
| `agents/agent/env.ts:78`, `shared/src/bot/generation.ts:28` | `/@sha256:[a-f0-9]{64}$/u` | `z.hash("sha256")` | Same, on a supply-chain image pin.                                                                                                                                                 |

**Right:** name it with `z.stringFormat` preserving the byte-identical regex. Do **not** substitute.
**Detection:** RegExp argument to `.regex()` whose source matches a built-in shape with differing parameters — `/^[A-Za-z0-9_-]{N}$/` where `N !== 21`; `/[0-9a-f]{64}/` without `A-F` and without the `i` flag; `/^[0-9a-f]{8}-…-…-…-{12}/`. Emit as a **negative assertion** and mark non-autofixable.

### `hand-rolled-uuid-regex` — 1 site · validation

**Wrong** — `packages/bot/src/agent/hitl/components.ts:194`:

```ts
function isDispatchId(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}
```

**Right:** `z.uuid().safeParse(parts[2]).success`.
**Buys:** a hand-transcribed copy of zod's own UUID pattern — same `[1-8]` version range and `[89abAB]` variant range, digit for digit. The value it guards is `dispatchId`, which is `z.uuid()` at nine places in `shared/src/wire.ts` (97,154,226,265,282,289,303,321,326). The local copy was **stricter** than the producer, so it would have rejected a `custom_id` the wire contract considers valid. Also removes a hand-rolled `value is string` predicate (`rayhanadev/no-type-erasure`).
**Inert?** No — zod's pattern additionally accepts the nil and max UUIDs, so the swap loosens by exactly two values. Both unreachable: every dispatchId originates from `crypto.randomUUID()` (`shared/src/conversations/queue.ts:293`).
**Detection:** RegExp literal whose source matches `/\[0-9a-fA-F?\]\{8\}-.*\{4\}-.*\{4\}-.*\{4\}-.*\{12\}/`. Carry sibling entries for hand-rolled email (`/@/` + TLD group), hostname, base64 and IPv4 — all were grepped for and this UUID is the only standard format hand-rolled today, so the rule starts at one violation and exists to stop the next.

### `template-literal-type-as-bare-string` — 5 sites · validation · partial

**Wrong** — `packages/agents/agent/subagents/code/tools/code_task.ts:14`:

```ts
const REPO_PATTERN = /^purduehackers\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/u;
repo: z.string().regex(REPO_PATTERN, "Repository must be a single purduehackers/<name> path."),
```

**Right:**

```ts
repo: z.templateLiteral(["purduehackers/", z.stringFormat("github-repository-name", /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/u)]),
```

**Buys:** the org pin becomes a **type-level** guarantee — the inferred type is `` `purduehackers/${string}` `` — while still emitting a single `pattern` to JSON Schema, so the model-facing input is no weaker. Verified: accepts `purduehackers/wack-hacker`, rejects `evil/repo` and `purduehackers/a/../b`.
**Sites:** `code/tools/code_task.ts:14` (applied) · `discord/lib/operations/guild.ts:61-64` (dataUri) · `roles-channels.ts:56` (hexColor) · `agents/agent/env.ts:78` and `shared/src/bot/generation.ts:28` (`${string}@sha256:${string}`).
**Honest payoff limit:** `z.templateLiteral([z.string().min(1), "@sha256:", z.hash("sha256")])` accepts `"junk\n@sha256:<64hex>"` exactly as the current unanchored regex does — a leading `z.string()` part is equally permissive, so the two image sites buy the type and nothing else unless the first part is also tightened.
**Detection:** `.regex()` on a `z.string()` receiver where the source (resolved through a same-file const) contains a run of ≥3 consecutive literal, non-metacharacter characters adjacent to `^`, `$`, or a class/quantifier group.
**Must not suggest:** any part schema whose pattern contains a top-level alternation. `z.base64()` is the live case — its regex allows `""` via `^$|`, so `z.templateLiteral(["x", z.base64()])` rejects `"xaGk="` and accepts `"aGk="`. The `guild.ts` dataUri conversion must use `z.string().regex(/[A-Za-z0-9+\/=]+/u)` for the payload part.

### `bare-string-url-on-tool-input` — 14 sites · model-schema

**Wrong** — `packages/agents/agent/subagents/figma/lib/dev-resources.ts:41`: `url: z.string().describe("The resource URL")`.
**Right:** `url: z.url().describe("The resource URL")`.
**Buys:** the value comes from the model, goes straight into a provider write call, and is never checked. `z.url()` adds `format:"uri"` to the JSON Schema and turns a garbage value into a typed rejection before it reaches Figma/GitHub/Payload. The repo already contradicts itself on identical fields — `figma/lib/webhooks.ts:61,97` use `z.url()` for a callback URL while `dev-resources.ts:41,65` use bare `z.string()` for a resource URL.
**Sites:** `figma/lib/dev-resources.ts:41,65` · `github/lib/organization.ts:222` · `github/lib/deployments.ts:86,87` · `vercel/lib/projects.ts:24` · `cms/lib/ugrants.ts:89,90,121,122` · `cms/lib/events.ts:91,122`.
**Use `z.url()`, not `z.httpUrl()`** — the latter pins hostname to `z.regexes.domain` and rejects localhost/IP literals. Where the value is `fetch()`ed, add `{ protocol: /^https?$/u }`: `cms/lib/media.ts:90 upload_media.url` was passed straight to `fetch()`, and Bun's fetch resolves `file://`, so the old schema let a model exfiltrate a local file into the CMS media library.
**Detection:** property inside the `input:`/`inputSchema:` `ObjectExpression` of `defineTool`/`defineDomainTool` whose value chain bottoms out at bare `z.string()` and whose key matches `/(^|_)url$|Url$|(^|_)uri$|Uri$/` OR whose `.describe()` literal matches `/\bURLs?\b|https?:\/\//`.
**Must not flag (the `input:`-ancestor condition is what keeps these out — without it the rule fires on 13 response fields and causes outages):** `cms/lib/client.ts:20,65,86,88,89,101` (Payload serves media `url` as a site-relative path), `github/lib/projects.ts:26,49,85`, `outreach/lib/enrichment.ts:20`, `bot/src/integrations/cms.ts:37`. Also excluded by shape: `vercel/lib/deployments.ts:37,123` (`id_or_url` accepts `dpl_…` OR a hostname) and `notion/lib/pages.ts:34,35,74,75` (`icon`/`cover` accept an emoji OR a URL).

### `bare-string-email-on-tool-input` — 1 site · model-schema

**Wrong:** `packages/agents/agent/subagents/linear/lib/users.ts:136` — `email: z.string().describe("Email address to invite")`.
**Right:** `z.email()`.
**Buys:** `linear/lib/membership.ts:18` already reads `email: z.email().describe("Email address to invite")` — same field, same describe string, same subagent. One got the format, the other did not.
**Detection:** the highest-signal form is not a key allowlist — flag when the **same key name** is modelled as `z.email()` somewhere and bare `z.string()` elsewhere. A cross-file consistency check catches this class without hardcoding.
**Must not flag:** the six response-side `email: z.string().optional()` fields (`outreach/lib/enrichment.ts:18`, `finance/lib/{invoices:16,donations:13,card-charges:17}`, `cms/lib/client.ts:32,108`). HCB and Payload return junk in an email column and rejecting the whole response over it breaks the tool.

### `min1-accepts-whitespace` — 80 sites · validation · **mutating fix, scope carefully**

**Wrong:** `z.string().min(1).max(64)` — verified: `z.string().min(1).safeParse(" ")` **succeeds**.
**Right:** `z.string().trim().min(1).max(64)`.
**Buys:** every one of these 80 fields exists to be non-empty — usernames, channel names, prompts, reasons, secrets, descriptions — and a single space satisfies all of them. The repo already knows the right form and uses it in exactly 5 places (`tools/schedule_task.ts:15,16,24,25`, `code/tools/post_finish.ts:41`), so 75 sites are the outlier.
**Order matters and the rule should enforce it:** `.min(1).trim()` accepts `" "` and silently yields `""` (verified). Zero sites have that inversion today; keep it that way with a companion rule.
**Sites (concentrations):** `shared/src/wire.ts` 23 · `discord/lib/operations/*` 22 · `agents/agent/env.ts` 9 · plus `bot/src/env.ts:21`, `scripts/check-capabilities.ts:15,17,18,20`, `policy/engine.ts:21,30`, `code-sandbox/harness.ts:105,161`, `shopping/lib/cart.ts:40,41,60,77`, `shared/src/bot/generation.ts:25,26`, `bot/src/agent/client.ts:160,161`, `bot/src/agent/render/discord-rest.ts:31`.
**Inert?** No — and not only on the accept set. **`.trim()` MUTATES the parsed output.** On env `secret` (`z.string().min(1)`, ~40 credentials) the mutation is desirable: it strips the trailing newline a copy-pasted token carries. Everywhere else it is a decision. `.trim()` contributes nothing to JSON Schema (verified: only `minLength:1` survives), so tool-input sites see no schema change.
**Detection:** `.min(1)` whose receiver chain contains `z.string()` and does **not** contain `.trim()` earlier in the chain. Companion: `.trim()` appearing **after** `.min`/`.max`/`.length` in a ZodString chain.
**Must not flag — opaque identifiers that must round-trip byte-exactly:**

- `wire.ts` `renderInputOption.id`, `requestId` (×2), `optionId`, `sessionId`, `eveTurnId` — the id is rendered into a Discord `custom_id` and compared back; the Eve handles are compared for equality by the Lua transitions.
- `bot/src/agent/client.ts:160,161` `sessionId`/`continuationToken` — minted by the agent and echoed back on the next request.
- `bot/src/agent/render/discord-rest.ts:31` `postedMessageSchema.id` — a Discord snowflake read back off a created message.
- Free-form authored payload: `discord/.../messages.ts` `send_message`/`edit_message` `content`; GitHub issue/PR bodies, comment bodies, commit messages, secret values. Trimming rewrites what the model authored.
- Automod `keyword_filter` / `regex_patterns` / `allow_list` — trailing whitespace is semantically load-bearing inside an automod pattern.

### `unconstrained-url-for-http-endpoint` — 8 sites · validation

**Wrong:** `AGENT_URL: z.url()` (and `BOT_URL`, `UPSTASH_REDIS_REST_URL`, `GLOBAL_CONFIG`, `SENTRY_DSN`).
**Right:** `z.url({ protocol: /^https?$/u })`.
**Buys:** bare `z.url()` delegates to the WHATWG parser, which accepts `javascript:alert(1)`, `data:text/html,<h1>x`, `mailto:`, `ftp://` and `wss://` — all five verified as parsing successfully. Every one of these variables is an HTTP endpoint the process will `fetch()`, so a mistyped or injected scheme should fail at boot.
**Sites:** `packages/bot/src/env.ts:31,37,65` · `packages/agents/agent/env.ts:27,36,39,44,83`.
**Detection:** `z.url()` with zero arguments (or an options object lacking both `protocol` and `hostname`) as a property value inside the `server` object of a `createEnv(…)` call.
**Must not flag:** `TURSO_DATABASE_URL` (`agents/agent/env.ts:32`) — it is `libsql://` and `file:` locally, so it correctly stays `z.string().min(1)`. And do **not** suggest `z.httpUrl()`: it rejects `http://127.0.0.1:8080`, which `.env.example:33` ships as `BOT_URL`.

### `iso-timestamp-as-bare-string` — 32 sites · model-schema

**Wrong** — `packages/agents/agent/subagents/linear/lib/reminders.ts:12`:

```ts
reminderAt: z.string().describe("ISO 8601 datetime"),
```

**Right:** `reminderAt: z.iso.datetime({ offset: true }).describe("ISO 8601 datetime")`.
**Buys:** the `.describe()` already carries the contract in prose while the schema enforces nothing. `z.iso.date()` emits `{"type":"string","format":"date","pattern":…}` and `z.iso.datetime()` emits `format:"date-time"` — the model gets a machine-checkable constraint instead of a hint it can ignore. This is a real downstream defect: `linear/lib/reminders.ts:15` does `new Date(reminderAt)` and `linear/lib/cycles.ts:67,68,93,94` do `new Date(starts_at)` on these unvalidated strings, so a model hallucinating "next Tuesday" ships an `Invalid Date` into the Linear SDK. The repo already does it right at `finance/lib/transactions.ts:54,55` and `finance/lib/donations.ts:71,72` with identical describe text.
**Sites:** `linear/lib/projects.ts:18,19,43,44,66,85`; `cycles.ts:60,61,85,86`; `initiatives.ts:24,49`; `reminders.ts:12`; `constants.ts:31` · `sentry/lib/releases.ts:85,131,132` · `vercel/lib/team.ts:277,278`, `account.ts:50,51` · `github/lib/issues.ts:307`, `contents.ts:145,146` · `cms/lib/events.ts:87,88`, `hack_night_sessions.ts:81` · `outreach/lib/deals.ts:74,119`, `companies.ts:148` · `lib/core/web-search.ts:42,46`.
**Picking the right one:** `z.iso.date()` where the describe says YYYY-MM-DD, `z.iso.datetime({offset:true})` where it says datetime. `z.iso.datetime()` without `offset` **rejects** `+05:00` forms (verified). Add `local: true` where the model legitimately writes zoneless local times — `cms/lib/constants.ts` took `z.iso.datetime({ offset: true, local: true })` for exactly that reason. Prefer a `z.union([z.iso.date(), z.iso.datetime()])` where the provider accepts both (GitHub `list_commits` since/until, Exa published-date filters).
**Detection:** `.describe(<StringLiteral>)` whose receiver chain bottoms out at a bare `z.string()` (no `.regex`/`.min`/format anywhere) AND whose literal matches `/\bISO\b|YYYY-MM-DD|RFC ?3339|date-?time/i`.
**Must not flag:** literals matching `/sort|order/i` — that filter is load-bearing. `sentry/lib/logs.ts:24` and `sentry/lib/traces.ts:33` say `Sort field (e.g. '-timestamp')` and are false positives. Also exclude `broadcasts.ts scheduled_at` (Resend accepts natural language `"in 1 hour"` alongside ISO — documented and supported).

### `owned-store-ids-as-bare-string` — 11 sites · validation

**Wrong** — `packages/agents/agent/lib/schedule/store.ts:231-245`:

```ts
const rowSchema = z.strictObject({
  id: z.string(), // written as crypto.randomUUID()
  channelId: z.string(), // a Discord snowflake
  nextRunAt: z.string(), // written as date.toISOString()
});
```

**Right:** `id: z.uuid()`, `channelId: snowflake`, `nextRunAt: z.iso.datetime()`.
**Buys:** these decode rows out of our **own** Turso tables, written by our **own** code — the one place tightening carries no upstream-contract risk. Every writer was traced: `id` is `crypto.randomUUID()` (`store.ts:629`), timestamps go through a helper returning `date.toISOString()` (`store.ts:173`), `ownerId`/`channelId` arrived over the wire schema that already validates them as snowflakes. The same fields are modelled correctly one layer up — `wire.ts:326 scheduleId: z.uuid()`, `tools/cancel_task.ts:10 id: z.uuid()` — so the store schema is strictly weaker than the contract it persists.
**Sites:** `schedule/store.ts:231,240,244,245,258,268` · `lib/core/audit-log.ts:34,36,43`.
**Inert?** No, and it is a **live-data** change: rows written before the format existed (hand-inserted, or an older id scheme) now fail to decode, turning a silent bad row into a loud parse error. That is the desired direction but should land with a check of existing rows.
**Detection:** property with a bare `z.string()` value inside an object schema annotated `satisfies z.ZodType<typeof table.$inferSelect>` — a schema explicitly bound to a Drizzle table type — where the key matches `/^id$|Id$|At$|Hash$|Digest$/`. **The Drizzle-type binding is the discriminator** that separates our own storage from provider responses; without it this rule fires on the 228 bare strings in response-projection files.
**Must not flag — both verified unsafe:**

- `schedule/store.ts` `createdAt`/`updatedAt`: the columns carry a SQL default `(CURRENT_TIMESTAMP)` (`shared/src/db/schemas/scheduled-tasks.ts`), which SQLite renders as `YYYY-MM-DD HH:MM:SS` — no `T`, no zone. `z.iso.datetime()` rejects it, and a rejected row aborts the whole `claimDueTasks` batch, stalling the dispatcher.
- `lib/core/audit-log.ts` `id`: audit ids are **not** UUIDs — `lib/policy/domain-audit-hook.ts` mints composite `` `${event.meta.id}:${callId}` `` ids.

---

## B. Numbers

### `tool-input-integer-as-number` — 186 sites · model-schema

**Wrong** — `packages/agents/agent/subagents/github/lib/pull-requests.ts`:

```ts
input: z.object({
  pull_number: z.number().describe("PR number"),
  limit: z.number().max(100).optional(),
});
```

**Right:** `pull_number: z.int().positive()`, `limit: z.int().min(1).max(100).optional()`.
**Buys:** 186 of the 193 non-`.int()` `z.number()` sites reachable from a tool `input:` are semantically integers — provider ids, record numbers (`issue_number` ×9, `pull_number` ×9), pagination counts (`limit` ×23, `first` ×9), and **33 Unix-millisecond cursors**. Today the model may legally emit `pull_number: 2.5` or `limit: 1e21` and zod passes it straight to the provider SDK. `z.int()` changes the emitted JSON Schema from `{"type":"number"}` to `{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991}`.
**Distribution:** vercel 62 · github 54 · cms 46 · linear 11 · figma 7 · sentry 6.
**Detection:** `z.number()` with no `.int()` in its chain, inside the subtree of an `input:` property of `define(Domain)Tool`, AND whose owning key matches `/^id$|_id$|_ids$|^ids$|_number$|^number$|^(limit|first|page|page_size|per_page|depth|count|offset|since|until|from|to|priority|quantity|position|milestone|frequency|duration)$/`. The key allowlist keeps it off `price`/`scale`/`amount`/`x`/`y`; the `input:` anchor keeps it off response projections.
**Must not flag — 7 genuinely fractional sites, verified by reading:** `figma/lib/comments.ts:55` (`x`), `:56` (`y`), `figma/lib/nodes.ts:38` (`scale`, `.min(0.01)`), `outreach/lib/deals.ts:71` and `:117` (`amount`, dollars), `shopping/lib/cart.ts:42` (`price`, USD), `vercel/lib/integrations.ts:92` (metadata JSON-scalar union member). Plus the **45 `z.number()` sites in provider RESPONSE projections** (score, rating, confidence, extracted_price, amount_cents, filesize, width, height, count) — tightening those starts rejecting live upstream payloads, which is an outage.

### `number-int-method` — 59 sites · inert · the single largest purely-mechanical win

**Wrong:** `z.number().int()` · **Right:** `z.int()`.
**Buys:** verified identical — same `number_format: "safeint"` check, same accepted set across 1 / 1.5 / NaN / ±Infinity / ±2^53 / 2^31 / 1e21, and byte-identical `toJSONSchema` output. `z.number().int()` builds a ZodNumber wrapping one check; `z.int()` is the ZodNumberFormat directly — one less node per schema. The repo had **0** `z.int()` before the migration.
**Distribution:** `discord/lib/operations/*` 24 · `shared/src/wire.ts` 4 · `scripts/check-capabilities.ts` 4 · `cms/lib/*` 5 · `finance/lib/*` 6 · rest spread across 19 files.
**Detection:** `CallExpression{callee: MemberExpression{property:"int", arguments:[]}}` whose `callee.object` is `CallExpression{callee: MemberExpression{object: Identifier "z", property:"number"}, arguments:[]}`. Autofix: replace the inner+outer pair with `z.int()`, preserving the trailing chain.
**Must not flag:** `z.coerce.number().int()` — there is **no `z.coerce.int()`** in 4.4.3 (`Object.keys(z.coerce)` is exactly bigint/boolean/date/number/string), so a naive rewrite drops coercion and breaks env parsing. Assert the head `MemberExpression`'s object is `Identifier "z"`, not `MemberExpression z.coerce`. One site: `packages/bot/src/env.ts:44`.

### `int-enum-as-bare-number` — 6 sites · model-schema

**Wrong** — `packages/agents/agent/subagents/linear/lib/constants.ts:27`:

```ts
priority: z.number().optional().describe("0=None, 1=Urgent, 2=High, 3=Normal, 4=Low");
```

**Right:** `priority: z.literal([0, 1, 2, 3, 4]).optional().describe(…)`.
**Buys:** measured JSON Schema — bare gives `{"type":"number"}`, `z.literal([0,1,2,3,4])` gives `{"type":"number","enum":[0,1,2,3,4]}`. The model gets the allowed values instead of parsing them out of English, and `7`/`2.5` now reject (both currently pass). `z.literal([...])` also exposes `.values` as a Set for reuse in the execute body.
**Sites:** `linear/lib/constants.ts:27` (spread into 2 tool inputs), `linear/lib/projects.ts:20,45`, `linear/lib/customer-requests.ts:14,34`, `vercel/lib/deployments.ts:59` (`follow`, `1 to follow (stream); 0 for one-shot` → `z.literal([0,1])`).
**Detection:** a `z.number()`-headed chain containing `.describe(StringLiteral)` where the literal matches `/^\s*\d+\s*=/` and contains 2+ occurrences of `/\b\d+\s*=/`. **Report-only, not autofix** — the legend parse needs a human to confirm completeness.

### `refine-integer-predicate` — 1 site · validation

**Wrong:** `packages/shared/src/bot/health.ts:6` — `websocketPingMs: z.number().refine(Number.isInteger, "expected an integer").min(-1)`.
**Right:** `z.int().min(-1)`.
**Buys:** the refine version emits `{"type":"number","minimum":-1}` — the integer constraint is **invisible** to any schema consumer; `z.int().min(-1)` emits `{"type":"integer","minimum":-1,"maximum":9007199254740991}`. Also removes a runtime predicate.
**Inert?** No, and measured: `Number.isInteger` accepts values above 2^53 (`9007199254740992`, `1e300` both pass today); `z.int()` rejects them. The field is a websocket ping in ms sourced from `Number.isFinite(ping) ? Math.round(ping) : -1` (`bot/src/framework/server.ts:36`), so no producible value is affected.
**Detection:** `.refine(` whose first argument is `Number.isInteger` (or an arrow wrapping it) and whose head is `z.number()`. Generalize to `Number.isFinite` (redundant — `z.number()` already rejects NaN/Infinity), `Array.isArray`, `(v) => v instanceof X` → `z.instanceof`, `(v) => typeof v === "…"` (also a `no-typeof` violation).

---

## C. Objects and shapes

### `tool-input-not-strict` — 590 sites · validation · **the biggest single finding**

**Wrong:** `defineTool({ …, input: z.object({ repo: z.string(), run_id: z.number() }) })`
**Right:** `input: z.strictObject({ repo: z.string(), run_id: z.int() })`
**Buys:** executed against 4.4.3 under `io:"input"` — the mode a tool inputSchema is generated in (eve calls `toJSONSchema` with `{io:"input", target:"draft-2020-12", unrepresentable:"any"}`) — plain `z.object` emits **no `additionalProperties` key at all**, while `z.strictObject` emits `additionalProperties:false`. Strict tool-calling modes on both major providers require that. Runtime: a hallucinated extra key is currently silently **stripped** (`z.object({a}).parse({a:"x",b:1})` → `{a:"x"}`); after the change it raises `unrecognized_keys`, which the agent loop sees as a correctable tool error rather than a silently-dropped argument.
**This is an internal inconsistency, not a style preference:** all 57 discord tool inputs and all 3 `agent/tools/*` inputs already used `z.strictObject`. 590 of 669 violated the house style.
**Distribution:** vercel 166 · github 119 · sentry 68 · linear 64 · cms 54 · outreach 41 · figma 33 · notion 24 · finance 15 · shopping 6 — across 102 files.
**Detection:** `ObjectProperty{key:"input"}` inside a `CallExpression` whose callee matches `/^define(Domain)?Tool$/`, whose value's innermost zod constructor is `z.object`. Resolve the chain head by walking `.callee.object` down to the `z.<name>` MemberExpression so `z.object({…}).superRefine(…)` is still matched.
**Must not flag:** nested `z.object` inside a **response** projection — anchor strictly on the `input:` property value's own head call. Also leave the 23 `z.looseObject` sites alone (`github/base.ts`, `sentry/*`, `bot/ships.ts`) — correct usage on provider responses.
**Must not flag (rolling-deploy hazards, deliberately excluded):** `bot/src/agent/turn-messages.ts` (a newer instance writing a fourth field would make every entry read as a miss on the older instance); `shared/src/bot/{generation,health}.ts` and `conversations/render.ts` (records read across a rolling promotion — rejecting an unknown key turns an additive field into a failed readiness probe); `bot/src/agent/render/discord-rest.ts` (Discord adds message fields routinely).

### `optional-instead-of-exactoptional` — 332 sites · validation · **largest type↔schema gap**

**Wrong** — the idiom, 298 occurrences, e.g. `packages/agents/agent/subagents/github/lib/releases.ts`:

```ts
input: z.object({ repo: z.string(), name: z.string().optional(), body: z.string().optional() }),
execute: async ({ repo, name, body }) => octokit().rest.repos.createRelease({
  owner, repo,
  ...(name === undefined ? {} : { name }),
  ...(body === undefined ? {} : { body }),
})
```

…plus the helper at `packages/agents/agent/subagents/linear/lib/sdk-input.ts:19` (30 call sites, carries an `oxlint-disable`) and `discord/lib/rest.ts:46 compact` (4 call sites).
**Right:**

```ts
input: z.strictObject({ repo: z.string(), name: z.string().exactOptional(), body: z.string().exactOptional() }),
execute: async ({ repo, ...rest }) => octokit().rest.repos.createRelease({ owner, repo, ...rest })
```

**Buys:** zod 4.4.3 ships `.exactOptional()` / `z.exactOptional()` (`node_modules/zod/v4/classic/schemas.d.cts:611`) and the repo used it nowhere. Three things verified by execution: (a) `z.output` of `.exactOptional()` **is** assignable to an SDK `{ name?: string }` under `--exactOptionalPropertyTypes` while `.optional()` fails with **TS2375** — that assignability failure is the entire reason `sdkInput`'s `as T` and the 298 spreads exist; (b) `z.toJSONSchema` emits an **identical** document for both, so the model-facing schema does not change; (c) the premise in `sdk-input.ts`'s own doc comment — "Zod represents omitted optional fields as `undefined`" — is **false** for zod 4: `z.object({a: z.string().optional()}).parse({b:"x"})` returns an object where `"a" in result === false`, so that helper's runtime filter is dead code and only its cast is load-bearing.
**Deletes:** 298 spreads, 30 `sdkInput` call sites, 4 `compact` call sites, 2 `oxlint-disable` comments, and 4 of the 31 `no-type-erasure` violations. `sdk-input.ts` was deleted outright.
**Detection:** two shapes. (a) a `SpreadElement` whose argument is `ConditionalExpression{test: BinaryExpression(=== undefined), consequent: ObjectExpression[]}` inside an object literal in a tool `execute` body, where the tested identifier is a destructured key of the same tool's `input:` schema. (b) a call to a local helper whose body is `Object.fromEntries(Object.entries(x).filter(e => e[1] !== undefined))`.
**Must not flag / needs judgment:**

- `github/lib/repositories.ts set_branch_protection` — GitHub distinguishes "absent = leave alone" from "null = clear"; those fields keep `.nullable().optional()`.
- `vercel/lib/security.ts update_attack_challenge_mode` — the SDK types requestBody as a **union** (`Body1` requires `attackModeActiveUntil`, `Body2` forbids it); one object with an optional key is not assignable.
- ~40 sentry sites where the tool renames snake_case params to camelCase SDK fields (`date_released` → `dateReleased`), so a rest spread cannot replace the mapping.
- Paginated readers that pass the value straight through with no conditional spread — exactOptional there is churn with no simplification.

### `manual-exact-optional-spread-transform` — 4 sites · inert

**Wrong** — `packages/agents/agent/subagents/figma/lib/variables.ts:42` (and `:93`, `:143`, `:177`):

```ts
const S = InputSchema.transform((v): T => ({
  ...(v.name === undefined ? {} : { name: v.name }),
  ...(v.id === undefined ? {} : { id: v.id }),
})) satisfies z.ZodType<T>;
```

**Right:** one `z.strictObject({ name: z.string().exactOptional(), id: z.string().exactOptional() })` — the transform _and_ the separate InputSchema both disappear.
**Buys:** ~120 lines whose entire content is exact-optional plumbing against `@figma/rest-api-spec`. Net −85 lines when applied. Bonus: the transforms made these schemas **unencodable** (`z.encode` throws `Encountered unidirectional transform during encode` — verified), so removing them restores encodability. Behavioral delta is confined to explicit `{ id: undefined }` input, which `.exactOptional()` rejects and the transform accepted — impossible over JSON, and these are JSON tool inputs.
**Detection:** a `.transform()` whose arrow body is an `ObjectExpression` consisting **only** of `SpreadElement`s of `ConditionalExpression{test: x === undefined, consequent: {}, alternate: {x}}`.

### `object-strict-method` — 22 sites · inert

**Wrong:** `z.object({ hasNextPage: z.boolean() }).strict()` · **Right:** `z.strictObject({ … })`.
**Buys:** zod's own `.d.ts` marks it — `/** Consider z.strictObject(A.shape) instead */`. Verified identical: both produce `catchall: ZodNever`, both raise the same `unrecognized_keys` issue, and both emit byte-identical JSON Schema in `io:"input"` and `io:"output"`.
**Sites:** all 22 in one file — `packages/agents/agent/subagents/github/lib/projects.ts:12,30,34,36,38,56,59,61,63,65,87,94,100,103,105,109,111,113,115,119 (×2),121`. Safe here specifically because these are GraphQL response projections whose query text in the same file dictates the returned field set.
**Detection:** `CallExpression{callee: MemberExpression{property:"strict"}, arguments:[]}` whose `callee.object` resolves through any chain to a `z.object(…)` head. The fix must splice out **only** the `.strict()` link — `projects.ts:87` has `.strict().nullable()`.

### `shape-spread-drops-refinements` — 5 sites · **NEGATIVE rule / trap**

**Wrong (the "fix" you must refuse to make)** — given `packages/shared/src/wire.ts:94` `messagePayloadSchema = z.strictObject({…}).superRefine(fn)`:

```ts
const deliveryPayloadSchema = z.strictObject({
  ...messagePayloadSchema.shape,
  dispatchId: z.uuid(),
}); // silently drops fn
```

**Right:** `messagePayloadSchema.extend({ dispatchId: z.uuid() })` — **keep `.extend()` here**.
**Buys:** executed against 4.4.3 — `base.extend({x})` still enforces `fn` (parse of over-long content fails with the custom message); `z.strictObject({...base.shape, x})` does **not**. `.shape` is still present and still returns the keys, so the rewrite type-checks and looks correct while deleting the validator. At `wire.ts:153` the dropped `superRefine` enforces (a) `content <= MAX_CONTENT_CHARS` for non-scheduled turns and (b) the `scheduleId`/`occurrenceId` XOR against `kind === "scheduled"` — **on the durable bot→agent delivery path**.
**Sites:** MUST KEEP `.extend()`: `packages/shared/src/wire.ts:153`. Safe to spread (refinement-free bases): `shared/src/wire.ts:264`, `shared/src/bot/health.ts:13`, `cms/lib/client.ts:353`, `agents/scripts/check-capabilities.ts:22`.
**Detection:** `SpreadElement` whose argument is `MemberExpression{property:"shape"}` inside a `z.object`/`z.strictObject`/`z.looseObject` argument. Resolve the spread object to its declaring `VariableDeclarator` in-module; if that initializer's chain contains `.superRefine(`, `.refine(` or `.check(`, **ERROR**. Symmetrically, any rule that rewrites `.extend()` → shape-spread must refuse under the same condition.
**Also correcting the reference sheet:** `.extend()` does **not** throw on refined schemas in 4.4.3 and `.safeExtend()` is runtime-identical, so there is no `.extend()` → `.safeExtend()` conversion to make. Zero `.safeExtend()` uses today; 5 `.extend()` sites total.

### `update-schema-hand-redeclared` — 16 sites · model-schema

**Wrong** — `packages/agents/agent/subagents/cms/lib/ugrants.ts:84` and `:115`: `create_ugrant` declares 7 fields; `update_ugrant` retypes **every one of them** by hand with `.optional()` bolted on, plus `id`.
**Right:**

```ts
const ugrantFields = { name: z.string(), author: z.string(), image_id: documentId, … };
input: z.strictObject(ugrantFields)                                              // create
input: z.strictObject({ id: documentId, ...z.object(ugrantFields).partial().shape }) // update
```

**Buys:** `.partial()` had **0 uses** across 837 object schemas and this is exactly what it is for. Executed on the real ugrants shape: hand-written and derived produce byte-identical JSON Schema and identical accept/reject on `{id}`, `{id,name}`, `{id,published}`, `{id,extra}`, `{name}`.
**Honest caveat, measured on the real `events.ts` shape:** the create schemas carry `.describe()` on some fields (`start`: "ISO datetime for event start") that the hand-written update schemas dropped. `.partial()` carries those through, so the update tool's JSON Schema **gains** 3–4 field descriptions. Runtime validation unchanged; only what the model reads gets richer.
**Sites (8 pairs):** `cms/lib/emails.ts:84,106` · `events.ts:85,115` · `hack_night_sessions.ts:79,117` · `rsvps.ts:86,114` · `service_accounts.ts:90,112` · `shelter_projects.ts:86,110` · `ugrants.ts:84,115` · `users.ts:86,108`.
**Detection:** two `z.object` `ObjectExpression` arguments in the same module where keys(A) ⊂ keys(B), `|keys(B)| − |keys(A)| === 1`, the extra key is `id`, and every shared key's value in B is A's source text with `.optional()` appended (or already ending in it). **Report the pair; not mechanically autofixable** — the fix must hoist a shared const.
**Must not flag blindly:** `cms/lib/users.ts` — create has `password`, update omits it, so it needs `z.object(userFields).omit({password:true}).partial().shape`. The omit is load-bearing: `update_user` must not accept a password.

### `inline-id-union-not-shared` — 45 sites · inert

**Wrong:** `id: z.union([z.string(), z.number()])` retyped inline 45 times across 9 CMS tool modules.
**Right:** export the declaration that **already exists** at `packages/agents/agent/subagents/cms/lib/client.ts:11` (`const idSchema = z.union([z.string(), z.number()])`, used 8 times internally, simply not exported) as `documentId`.
**Buys:** the single most-repeated hand-redeclared schema in the repo. Sharing it makes the Payload document-id concept one named thing, gives one place to later tighten it (`z.union([z.string(), z.int().positive()])` — every one is a Payload row id, never fractional), and drops 45 duplicated AST subtrees.
**Distribution:** `ugrants.ts` 7 · `shelter_projects.ts` 7 · `rsvps.ts` 6 · `events.ts` 6 · `emails.ts` 6 · `hack_night_sessions.ts` 5 · `users.ts` 3 · `service_accounts.ts` 3 · `media.ts` 2.
**Detection:** `z.union` whose sole argument is an `ArrayExpression` of exactly `[z.string(), z.number()]` (order-insensitive) appearing more than twice within a directory.
**Must not flag across package boundaries:** `sentry/lib/base.ts`, `bot/src/integrations/ships.ts`, `bot/src/integrations/cms.ts` (1 each) — sharing a `documentId` across independently-deployed packages couples them to one another's Payload assumptions.

### `repeated-tool-input-shape` — 18 sites · inert

**Wrong:** `input: z.strictObject({ channel_id: channelId, message_id: messageId })` retyped 6× in one file; `{ repo: z.string().describe("Repository name"), ...paginationInputShape }` retyped 8× across 8 GitHub files.
**Right:** one shared shape const; `github/lib/constants.ts` already exports `paginationInputShape`/`perPageField`, so half the const existed.
**Buys:** 31 object bodies are byte-identical across 82 sites even counting `.describe()` text. **Only three groups clear the bar** — the audit explicitly declined to extract the other 28, which are 2-key tool inputs where a named const costs more than it saves.
**Sites:** `discord/lib/operations/messages.ts:252,265,278,314,373,416` · `github/lib/{actions.ts:12, deployments.ts:142, environments.ts:12, organization.ts:122, releases.ts:12, secrets-and-variables.ts:64,135, tags-refs.ts:11}` · `notion/lib/databases.ts:30`, `outreach/lib/{companies.ts:21, contacts.ts:18, deals.ts:22}`.
**Detection:** group all `z.object`/`z.strictObject` `ObjectExpression` arguments by normalized source text (comments/whitespace stripped, `.describe()` retained). Report groups with **≥4 members**, or **≥3 within a single file**. Below that threshold the noise-to-signal is too poor to lint on.

### `nested-response-shape-redeclared` — 2 sites · inert

**Wrong:** `packages/agents/agent/subagents/github/lib/projects.ts:21` declares a 6-key project shape; `:44` retypes the same 6 keys identically and adds `readme`/`fields`.
**Right:** `const projectSummaryShape = {…}` spread into both. Safe here (neither carries a refinement — see the trap above), and `pageInfoSchema` in the same file is already factored out this way.
**Detection:** two `ObjectExpression` arguments to `z.object`/`z.strictObject` in the same module where keys(A) ⊂ keys(B) and every shared key's value has identical normalized source. Distinguish from `update-schema-hand-redeclared` by the **absence** of an added `.optional()`.

### `omit-extend-instead-of-spread` — 1 site · inert

`packages/agents/scripts/check-capabilities.ts:22` — `skillDefinitionSchema.omit({instructions:true}).extend({instructionsDigest})` → `z.strictObject({ ...skillDefinitionSchema.omit({instructions:true}).shape, instructionsDigest })`. Verified exactly equivalent here (both reject an extra key; byte-identical JSON Schema with `additionalProperties:false`). **Autofix must choose `z.strictObject`/`z.looseObject` to match the base's `def.type`** — a blind rewrite to `z.object` silently loosens.

---

## D. Literals, enums, unions

### `enum-member-list-instead-of-enum-object` — 9 sites · inert

**Wrong:** `packages/agents/agent/lib/policy/engine.ts:18` — `z.enum([UserRole.Public, UserRole.Organizer, UserRole.Admin])`.
**Right:** `z.enum(UserRole)`.
**Buys:** the member list is a hand-maintained copy — adding a fourth `UserRole` silently leaves the policy engine's input schema accepting only three, with **no tsc error anywhere**. The codebase already contradicts itself: `lib/core/audit-log.ts:38` writes `z.enum(UserRole)` while `engine.ts:18` spells the members out. All 9 lists were verified exhaustive against their source object today (UserRole 3/3, PolicySource 2/2, CapabilityKind 3/3, RiskLevel 3/3, ConfirmMode 3/3, PrivacyMode 3/3, ScheduleType 2/2, ScheduleActionType 2/2, ScheduledTaskStatus 4/4), so the rewrite is inert now and drift-proof after.
**Sites:** `policy/engine.ts:18,23,29,32,34` · `schedule/store.ts:187,190,193`. The three `store.ts` sites are worse: they reference 8 module-local `"once" satisfies …` constants re-declaring three enums from `@repo/shared/db`; importing the objects deletes all 8.
**Gotcha this change carries:** object-derived enums key entries by **property name**, so any future `.exclude()`/`.extract()` takes `["Public"]`, not `["public"]`. Zero such call sites today.
**Detection:** `z.enum` whose argument is an `ArrayExpression` where every element is a `MemberExpression` with the same object identifier. Higher-confidence tier (auto-fixable): also require that the object resolves to `= {…} as const` and that the listed members equal `Object.keys(X)`.

### `hand-copied-enum-value-list` — 4 sites · inert

**Wrong:** `packages/shared/src/wire.ts:177-178`:

```ts
approvalMode:    z.enum(["self", "second-party"]).optional(),
approverMinRole: z.enum(["organizer", "admin"]).optional(),
```

**Right:** `z.enum(ConfirmMode).exclude(["None"])` and `z.enum(UserRole).exclude(["Public"])`.
**Buys:** these are typed-out copies of enums that already exist and are already imported elsewhere in the same package. `wire.ts:178` is `UserRole` minus `Public` — the codebase already spells that relationship at the type level in `policy/approval-record.ts:13` as `Exclude<UserRoleValue, typeof UserRole.Public>`, so schema and type maintain the same fact twice. Imports are clean: `shared/src/db/enums.ts` has **no imports at all** (no native libSQL — that is the `db/index.ts` barrel), `roles.ts` imports only `./constants.ts`.
**Sites:** `wire.ts:177` (ConfirmMode−None), `:178` (UserRole−Public), `:331` (ScheduleActionType verbatim) · `agents/scripts/check-capabilities.ts:16` (UserRole verbatim).
**Detection:** needs a project-wide index. Map every `export const X = {…} as const` with all-string-literal values to its value set; flag any `z.enum(<ArrayExpression of string literals>)` whose element set equals or is a subset of some `X`. Equal → suggest `z.enum(X)`; subset missing k → suggest `.exclude([<the KEYS>])`. **The fix must emit keys, not values** — `z.enum(UserRole).exclude(["public"])` throws `Error: Key public not found in enum` at module evaluation.
**Must not flag:** `packages/agents/agent/lib/core/audit-log.ts:28,46` — it duplicates `AuditDecision` **deliberately**, with an `as const satisfies AuditDecisionValues` guard and a comment stating it avoids loading native libSQL through the `@repo/shared/db` barrel. The `satisfies` already fails tsc on drift.

### `union-of-literals-to-literal-array` — 7 sites · model-schema

**Wrong:** `z.union([z.literal(1), z.literal(2), z.literal(3)])` · **Right:** `z.literal([1, 2, 3])`.
**Buys:** identical accepted set (verified). Two concrete gains: (1) `z.toJSONSchema(z.literal([1,2,3]))` emits `{"type":"number","enum":[1,2,3]}` where the union emits `{"anyOf":[{"const":1},…]}` — all 7 sites are inside `defineTool({input:…})`, so this is the schema the model reads, and a flat enum is both idiomatic and shorter in the tool-definition token budget. (2) One flat `{code:"invalid_value", values:[1,2,3]}` instead of a nested `invalid_union` carrying a per-branch sub-error array. Also unlocks `.values` (a Set), which unions do not expose (verified `undefined` on a union).
**Sites:** all 7 in `packages/agents/agent/subagents/discord/lib/operations/guild.ts:71,85,367,370,711,712,747`.
**Detection:** `z.union` whose sole argument is an `ArrayExpression` where **every** element is `z.literal` with a single primitive-literal argument, and all literals share one `typeof`.
**Must not flag — the two mixed unions, correct as written:** `assets.ts:234` (`z.literal("")` + `z.string().min(2).max(100)` — Discord accepts an explicit empty sticker description or a 2–100 char one) and `messages.ts:393` (`discordSnowflakeSchema` + `z.literal("@me")`).

### `superrefine-emulating-discriminated-union` — 6 sites (3 clean, 2 blocked) · judgment

**Wrong** — `packages/agents/agent/subagents/discord/lib/operations/guild.ts:85-118`:

```ts
z.strictObject({ type: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]), metadata: metaSchema.optional() })
  .superRefine((action, ctx) => {
    if (action.type === 2 && action.metadata?.channel_id === undefined) ctx.addIssue({…});
    if (action.type === 3 && action.metadata?.duration_seconds === undefined) ctx.addIssue({…});
    if (action.type !== 2 && action.metadata?.channel_id !== undefined) ctx.addIssue({…});
    …
  })
```

**Right:** `z.discriminatedUnion("type", [ z.strictObject({type: z.literal([1,4]), …}), z.strictObject({type: z.literal(2), metadata: z.strictObject({channel_id: snowflake, …})}), … ])`.
**Buys:** these encode "which sibling fields are required given the tag" — written by hand and in the **wrong direction** (a list of forbidden combinations rather than a set of legal shapes). A DU expresses it natively, survives into `z.infer` (callers get real narrowing instead of `scheduleId?: string` they must re-check) and into `z.toJSONSchema` as a `oneOf` the model can read. Verified: type-2-without-channel_id rejects as `metadata.channel_id: invalid_type`; type-1-with-channel_id rejects as `metadata: unrecognized_keys`; `z.literal(["mention","followup"])` works as a multi-value discriminator branch.
**Sites:** `shared/src/wire.ts:96` (refinement at `:127` — one DU replaces **both** the conditional `too_big` on content, 4 000 vs 9 000 chars, and the scheduleId/occurrenceId XOR) · `wire.ts:170` (`renderInputRequestSchema`) · `guild.ts:85` (clean) · `guild.ts:126` (**blocked**) · `schedule/store.ts:247` and `:272` (shared `validateScheduleShape` helper at `:199`).
**Audits disagreed:** audit 1 counted 6, audit 4 counted 3 (it excluded both `store.ts` sites as high-risk given the libsql null sentinel plus a trailing `.transform`). The migration applied the two `store.ts` sites successfully (as `z.discriminatedUnion("scheduleType", …)` restating the existing `scheduled_tasks_shape_check` SQL CHECK) and skipped both `wire.ts` sites — converting those makes `MessagePayload` a union type, and `channels/discord.ts:400-401` reads `payload.scheduleId` with no narrowing.
**Detection:** an object-schema call that (a) has a property whose value is `z.enum(<string literals>)`, `z.literal(…)`, or `z.union([z.literal(…)…])`, and (b) is chained to `.superRefine`/`.refine` whose callback body contains 2+ `BinaryExpression` `===`/`!==` comparing `<param>.<thatProperty>` against a literal that is a member of that enum. Report the option count as the payoff.
**Must emit a hard-block diagnostic, never a fix, when the discriminant's chain contains `.default(`/`.catch(`/`.prefault(`:** verified `z.discriminatedUnion` does **not** honor a default on the discriminator. `guild.ts:126 eventCreate` has `type: z.enum([…]).default("external")` — `{name, location, scheduled_end}` with no `type` is accepted today and would fail with "No matching discriminator". Same block on `messages.ts:463` (`include_archived` carries `.default(false)`).

### `object-union-with-shared-literal-key` — 1 site · inert

`packages/bot/src/agent/client.ts:157` — `z.union([z.object({ok: z.literal(true), …}), z.object({ok: z.literal(false), …})])` → `z.discriminatedUnion("ok", […])`. Boolean discriminators work in 4.4.3 (verified; unmatched yields `invalid_union` / "No matching discriminator" / `options:[true,false]` / `path:["ok"]`). Accepted set identical because the discriminant uniquely selects one branch. Payoff is consistency with the 4 existing `z.discriminatedUnion` sites, not a fix — the error is discarded anyway (`safeParse(value).success`).
**Detection:** `z.union` of ≥2 object schemas where some property K is present in **every** branch and every branch's value for K is `z.literal(<primitive>)` with pairwise-distinct values. Autofix: `z.discriminatedUnion("K", <same array>)`.

### `disjoint-key-object-union-to-xor` — 1 site · validation · **live silent-data-loss bug**

**Wrong** — `packages/agents/agent/subagents/github/lib/projects.ts:279`:

```ts
value: z.union([
  z.object({ text: z.string() }),
  z.object({ number: z.number() }),
  z.object({ date: z.string() }),
  z.object({ singleSelectOptionId: z.string() }),
]).describe("Field value to set");
```

**Right:** `z.xor([ z.strictObject({text}), z.strictObject({number}), … ])`.
**Buys:** this models GraphQL's `ProjectV2FieldValue`, a `oneOf` input. Executed: `.parse({text:"a", number:1})` **SUCCEEDS** and returns `{text:"a"}` — the first branch matches and `z.object` strips the rest. So when the model emits two field values, the tool silently drops one, mutates the project item with the wrong field, and reports success. `z.xor` requires exactly one branch to match and rejects the multi-match (verified). Note `z.strictObject` in the fix is what makes xor meaningful — with plain `z.object` all branches still match a superset object.
**Newly rejected:** an input object carrying more than one of the four keys. Nothing that previously produced a _correct_ mutation is affected.
**Detection:** `z.union` of ≥2 object schemas whose declared `.shape` key sets are pairwise **disjoint** AND where at least one branch is non-strict. Disjoint keys with no shared discriminant is the signature of a `oneOf` input; non-strict branches are what make the multi-match silent.
**Must not flag:** `linear/lib/membership.ts remove_member_from_platform` (email XOR user_id) — it enforces the invariant in `execute` with a human-readable result, and `z.xor` would turn a flat object into a `oneOf` that models handle noticeably worse for tool parameters.

### `literal-set-instead-of-enum` — 3 sites, 70 members · judgment

**Wrong** — `packages/agents/agent/subagents/notion/lib/notion-input.ts:34,52,73`:

```ts
const pagePropertyKinds: ReadonlySet<PagePropertyKind> = new Set([
  "title",
  "rich_text" /* …15 more */,
]);
function contains<T extends string>(collection: ReadonlySet<T>, candidate: string): candidate is T {
  return collection.values().some((member) => member === candidate);
}
```

**Right:** `const pagePropertyKind = z.enum([…]) satisfies z.ZodType<PagePropertyKind>` — membership becomes `.safeParse(key).success`.
**Buys:** measured, not guessed — `bunx oxlint` on this one file reported **19 of the repo's 137 outstanding oxray errors** (`no-typeof` + `no-type-erasure`), all in the guards this pattern feeds (`contains`, `isRecord`, `isQueryFilter`/`isQuerySorts`/`isCreatePageProperties`). Deletes `contains` entirely (zod does a Set lookup vs the current `.values().some()` linear scan) and exposes `.options`/`.enum`/`.exclude` — `pagePropertyKinds` and `dataSourcePropertyKinds` share 14 members and could derive from one another. `isQuerySorts` (`:135`) is itself a hand-rolled xor over `property` vs `timestamp`, and `isQueryFilter` (`:128`) compares against `"created_time"`/`"last_edited_time"` — the identical `z.enum` is already declared four times elsewhere (`notion/lib/databases.ts:32`, `outreach/lib/{companies.ts:23, deals.ts:24, contacts.ts:20}`).
**One correction to a plausible assumption:** annotating `satisfies z.ZodType<PagePropertyKind>` does **not** buy exhaustiveness — tested: it rejects an EXTRA member but accepts a schema MISSING members, exactly like `ReadonlySet<T>`. The win is deleting the predicates and the oxray errors, not compile-time completeness.
**Detection:** `new Set([...])` of ≥3 string literals whose `VariableDeclarator` has a `ReadonlySet<T>`/`Set<T>` annotation where `T` is not `string`. Independent second signal: a function whose body is `<set>.values().some(…)` or `<set>.has(…)` and whose return type is an `x is T` predicate.

### `stringified-boolean-enum` — 6 sites (1 actionable) · validation

**Wrong** — `packages/agents/agent/env.ts:71`:

```ts
BOT_SANDBOX_ENABLED: z.enum(["true","false"]).default("false").transform((value) => value === "true"),
```

**Right:** `z.stringbool({ truthy: ["true"], falsy: ["false"], case: "sensitive" }).default(false)`.
**Buys:** verified an **exact** behavioral match across the full input space: `"true"`→true, `"false"`→false, `"TRUE"`→REJECT, `"1"`→REJECT, undefined→false. Passing the options matters — bare `z.stringbool()` additionally accepts 1/0/yes/no/on/off/y/n/enabled/disabled and is case-insensitive, which is a real widening of a flag that gates whether a bot Sandbox is started at all. Also: `stringbool` is codec-backed, so `z.encode(schema, false)` returns `"false"`, where the current `.transform()` throws `$ZodEncodeError` — and `supervisor-config.ts` projects this env back out into a child container's environment, an encode direction the current schema structurally cannot serve. Note `.default(false)` takes the **output** type.
**Detection:** `z.enum` whose argument is exactly `["true","false"]` (either order). **Escalate to autofixable only when the chain also contains `.transform(v => v === "true")`** — that proves the caller wants a boolean.
**Must not flag — 5 sites where the string output is load-bearing:** `vercel/lib/deployments.ts:38`, `vercel/lib/projects.ts:221,225,227`, `vercel/lib/domains.ts:118`. All pass the parsed value straight to the Vercel SDK as a **query-string parameter**; `z.stringbool()` outputs boolean and would break the call.

---

## E. Refinements and custom validation

### `cross-field-issue-without-path` — 4 sites · inert

**Wrong** — `packages/shared/src/wire.ts:182`:

```ts
ctx.addIssue({ code: "custom", message: "approval policy is only valid for tool approval" });
```

**Right:** add `path: ["approvalMode"]`.
**Buys:** `wire.ts`'s own `decode()` renders each issue as `` path === "" ? message : `${path}: ${message}` `` (`wire.ts:398-401`). A top-level `addIssue` with no `path` produces `path: []`, so these 4 rejections reach the caller as bare unattributed sentences while the other 12 `addIssue` calls in the repo correctly carry a path. Same loss in `malformedRow` (`store.ts`), which keys its error off `issue.path[0]` and would report the literal string `"row"`.
**Sites:** `wire.ts:182` → `["approvalMode"]`, `:185` → `["approverMinRole"]`, `:243` → `["optionId"]`, `:252` → `["approvalRequester","userId"]`.
**Detection:** `ctx.addIssue({…})` whose `ObjectExpression` has **no** `path` property, where the enclosing arrow is the argument of a `.superRefine`/`.refine`/`.check` whose receiver is a `z.object`/`z.strictObject`/`z.looseObject` call.
**Must not flag:** a non-object receiver — e.g. the `z.string().transform` at `store.ts:222`, where zod auto-prefixes the parent key (verified: yields `path: ["memberRoles"]`).
**`when` is needed nowhere.** Verified: a top-level object refinement still RUNS after a continuable inner failure (a `too_small` on a sibling) and is skipped only on `invalid_type`. No cross-field check in this repo is being blocked.

### `string-shape-refine-not-named-format` — 1 site · validation

**Wrong** — `packages/agents/agent/subagents/code/tools/post_finish.ts:36`:

```ts
commitMessage: z.string()
  .trim()
  .min(1)
  .max(72)
  .refine((v) => !v.includes("\n"), "Commit message must be one line.");
```

**Right:** `z.string().trim().min(1).max(72).check(z.stringFormat("single-line", /^[^\n]*$/u))`.
**Buys:** (1) `{code:"invalid_format", format:"single-line"}` instead of `{code:"custom"}`. (2) **Model visibility** — verified via `z.toJSONSchema` that a `.refine` is erased completely (emits bare `{type:"string"}`), so the model is currently never told the commit message must be one line; `z.stringFormat` emits both `format` and `pattern`. Confirmed `.trim()` is an overwrite check, not a transform — it runs in chain order (so `.min(1)` sees the trimmed value) and does not break `z.encode`, unlike `.transform(s => s.trim())` which throws `$ZodEncodeError`. The `.check()` placement matters: it makes the format run **after** `.trim()`, exactly as the old refine did.
**Deliberate choice:** `/^[^\n]*$/u`, not `[^\r\n]` — the current predicate only rejects `\n`, so a lone `\r` passes today. Keeping `\n`-only makes it provably inert on a destructive publication tool.
**Detection:** `.refine(fn)` rooted at `z.string()` whose callback body is a single (optionally negated) `String.prototype` shape call on the parameter — `.includes`, `.startsWith`, `.endsWith`, `.match`, `.test`, or a `.length` comparison. Map `.startsWith`/`.endsWith`/`.includes`/`.length` to the built-in checks of the same name; map negations and regex tests to `z.stringFormat`.

### `refine-duplicated-by-runtime-guard` — 1 site · inert

`packages/agents/agent/subagents/discord/lib/operations/messages.ts:463` has a `superRefine` enforcing `include_archived requires channel_id`; `:472-478` re-tests the identical condition in `execute` and throws `UpstreamError({service:"Discord", status:400, …})`. The superRefine runs on the tool's inputSchema, so the throw is **dead code** that duplicates the message and misattributes a caller error to Discord. Deleting it removes the drift risk. The superRefine itself is correct and must stay (`include_archived` carries `.default(false)`, so a DU is unavailable).
**Detection:** within a `defineTool({input, execute})`, collect each condition tested inside the input schema's refine callback, then flag any `IfStatement` in `execute` whose test is structurally identical (same operators, same member paths modulo the `value.` → `input.` rename) and whose consequent is a `ThrowStatement`.

---

## F. Codecs, transforms, defaults, coercion

### `redis-dual-shape-json-decoder` — 6–7 sites · inert

**Wrong** — six near-identical copies of "Upstash hands back JSON text OR an already-deserialized value":

```ts
const decoded: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
return schema.parse(decoded);
```

**Right:**

```ts
const jsonCodec = <T extends z.ZodType>(schema: T) =>
  z.codec(z.string(), schema, {
    decode: (s, ctx) => {
      try {
        return JSON.parse(s);
      } catch (e) {
        ctx.issues.push({
          code: "invalid_format",
          format: "json",
          input: s,
          message: (e as Error).message,
        });
        return z.NEVER;
      }
    },
    encode: (v) => JSON.stringify(v),
  });
const stored = <T extends z.ZodType>(schema: T) => z.union([jsonCodec(schema), schema]);
return stored(schema).parse(raw);
```

**Buys:** three payoffs. (1) It deletes six `typeof` expressions, each an oxray `no-typeof` ERROR — moving the 137-violation count **down**. (2) Two of these `JSON.parse` calls are **unguarded**: `admission.ts:74` throws a raw `SyntaxError` instead of its intended "Redis returned an invalid delivery admission" Error, and `generation.ts:42` throws `SyntaxError` instead of a ZodError, so `endpoint.ts:18 resolveBotBaseUrl` surfaces the wrong error type on a corrupt Redis value. (3) `admission.ts:75-96` is 22 further lines of typeof-guarded narrowing that a `z.discriminatedUnion("status", …)` replaces outright.
**Sites:** `shared/src/conversations/admission.ts:74` · `shared/src/bot/generation.ts:42` · `shared/src/conversations/queue.ts:277` · `agents/agent/channels/discord.ts:179` · `agents/agent/lib/bot/supervisor.ts:483` · `shared/scripts/ops-inspect.ts:32` (audit 5 adds `schedule/store.ts:216`, hence 6 vs 7).
**Detection:** `ConditionalExpression` whose test is `typeof <id> === "string"` and whose consequent is `JSON.parse(<same id>)`, feeding a `.parse`/`.safeParse`. Also the early-return variant `if (typeof raw !== "string") return decode(raw)`.

### `json-roundtrip-without-codec` — 3 sites · inert

**Wrong** — encode at `packages/agents/agent/lib/schedule/store.ts:385` (`JSON.stringify(owner.memberRoles ?? [])`) and decode at `:220` (12 lines of `.transform` + `ctx.addIssue` + `.pipe(z.array(z.string()))`).
**Right:** `const memberRolesSchema = jsonCodec(z.array(z.string())).nullable()`; the write becomes `z.encode(memberRolesSchema, …)`.
**Buys:** these three are the **honest** codec cases — the encode direction genuinely exists as hand-written `JSON.stringify` in the same module, so one declaration replaces a hand-rolled pair and the two halves can no longer drift. `store.ts` is the strongest: 12 lines collapse to one. Verified round-trip and that bad JSON yields a descriptive `invalid_format`/`format:"json"` issue rather than the current vague `custom`.
**Sites:** `schedule/store.ts:220` + `:385` · `code-sandbox/harness.ts:309` + `:418` · `agents/scripts/check-capabilities.ts:185` + `:46`. Applied additionally at `shared/src/conversations/render.ts` (both `JSON.stringify` write sites became `z.encode(projectionCodec, …)`), where the write is now validated by the same schema the read enforces.
**Must not flag:** write paths where a validation throw would strand a resource. `harness.ts` park site keeps `JSON.stringify(resume)` — at that point the sandbox is detached and `parked` is true, so a throw would skip the finally-block teardown and strand a live, billing sandbox. Likewise `conversations/queue.ts` enqueue: `z.encode` through a schema carrying `.trim()` plus `.superRefine` would introduce a throw on a write path that currently cannot fail.

### `json-parse-argument-of-safeparse` — 4 sites (1 live defect) · inert

**Wrong** — `packages/agents/agent/lib/code-sandbox/harness.ts:309`:

```ts
const decoded = resumeStateSchema.safeParse(JSON.parse(input.parked.resumeState));
if (decoded.success) {
  try {
    /* resume */
  } catch {
    /* fresh session */
  }
}
```

**Right:** `jsonCodec(resumeStateSchema).safeParse(input.parked.resumeState)`.
**Buys:** `safeParse` cannot catch a throw raised while evaluating its own argument. A corrupt persisted `resumeState` throws a `SyntaxError` out of `openSession` and never reaches the `if (decoded.success)` fall-through that exists precisely to recover by starting a fresh session — **the parked-sandbox recovery path is unreachable for the most likely corruption mode.** The try/catch at `:311` is _inside_ the success branch.
**Sites:** `harness.ts:309` (unguarded — the defect) · `cms/lib/client.ts:191` and `channels/discord.ts:181` (already try/catch-wrapped, so correct today) · `check-capabilities.ts:185` (build script, throwing is fine).
**Detection:** `<schema>.safeParse(JSON.parse(…))` — a `CallExpression` `JSON.parse` as the direct argument of `.safeParse`/`.parse`, not enclosed in a `TryStatement`.
**Must not flag:** a `JSON.parse` sitting inside a `Result.tryPromise` whose catch already maps any throw to a typed error — the throw is handled, just not by a `TryStatement` the rule can see.

### `iso-string-to-date-by-hand` — 6 sites + 2 bidirectional clusters · judgment · **BLOCKED, read this before you write the rule**

**Wrong** — `packages/agents/agent/tools/schedule_task.ts:11` declares `runAt: z.iso.datetime({offset:true})`, then `:38` does `scheduleStore.create(owner, { runAt: new Date(schedule.runAt) })`.
**The canonical zod-4 answer:**

```ts
const isoDatetimeToDate = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
});
```

Verified end to end: `parse` yields a real Date, `z.encode` round-trips, a bad input safe-fails rather than yielding `Invalid Date`, and `toJSONSchema(…, {io:"input"})` still emits `format:"date-time"`.
**Why it was NOT applied, and why your rule must say so:** `packages/agents/agent/lib/policy/domain-runtime.ts:336` re-parses the value the AI SDK **already** parsed with the same `spec.input` schema (see `double-tool-input-validation`). Any tool-input schema whose `z.output` differs from its `z.input` — a `string → Date` transform or codec — therefore fails that second parse with "expected string, received Date", turning every affected tool call into an `InvalidInput` error. Two independent areas hit this and both backed out. **These sites become safe only after `domain-runtime.ts:336` is removed.**
**Sites:** validated-string conversions (safe, mechanical): `tools/schedule_task.ts:38`. Bare-string conversions (the reason it matters): `linear/lib/reminders.ts:15`, `linear/lib/cycles.ts:67,68,93,94`, `schedule/store.ts:550`. Bidirectional clusters where a codec is genuinely warranted: (A) `shared/src/bot/generation.ts:31-32` schema + `supervisor.ts:1104-1105` hand-encode + three hand-decoders at `bot/endpoint.ts:18`, `shared/scripts/release-check.ts:58`, `bot/src/agent/hitl/interaction.ts:85`; (B) `tools/schedule_task.ts:11` + `store.ts:169-173` (an `iso()` helper that also hand-checks `Number.isFinite(date.getTime())` — work `z.date()` already does).
**A `.transform()` is the wrong tool here:** `z.encode()` throws on a schema containing one.
**Detection:** `new Date(x)` / `Date.parse(x)` where `x` traces to a destructured property of a zod-parsed object. Cheap high-signal proxy needing no dataflow: `new Date(<ident>)` inside the `execute` callback of a `defineTool` whose `input:` schema declares a same-named key.
**Must not flag:** `discord/.../messages.ts:155 nextArchiveCursor` — the cursor is sent back as Discord's `before` query param, and `new Date(s).toISOString()` truncates to milliseconds where Discord's `archive_timestamp` carries microseconds, so round-tripping through a Date silently shifts the pagination window.

### `date-parse-on-already-validated-iso` — 4 sites · inert

**Wrong:** `Date.parse(parsed.data)` where `parsed.data` came out of a `z.iso.*` schema in the same function.
**Right:** a plain `.transform((s) => new Date(s))` on the schema — a codec here is over-engineering because nothing ever encodes these back.
**Sites:** `discord/lib/operations/messages.ts:155` (two `Date.parse` calls), `:449` · `finance/lib/transactions.ts:85-86` · `finance/lib/donations.ts:81-82`.
**Must NOT extend to:** `transactions.ts:93-94` and `donations.ts:90-91`. Those `Date.parse` calls run on `t.date` / `d.created_at`, which are bare `z.string().optional()` **HCB provider projections** (`transaction-shape.ts:11`, `donations.ts:17`). Tightening them starts rejecting live HCB payloads. Their current NaN-on-garbage behavior is a separate pre-existing looseness worth a comment, not a schema change.

### `optional-default-redundant` — 8 sites · inert

**Wrong:** `first: z.number().optional().default(25)` · **Right:** `first: z.int().default(25)`.
**Buys:** `.default()` already makes the input optional. Verified byte-identical on both axes: `.parse(undefined)` === 25 either way, and `z.toJSONSchema` produces the identical `{"default":25,"type":"number"}` with the key absent from `required`. Pure noise removal.
**Sites:** `lib/core/web-search.ts:26,31,40` · `linear/lib/{initiative-updates.ts:20, issue-views.ts:17, project-updates.ts:21, project-views.ts:12, users.ts:82}`. Three of these are multi-line and are **missed by a single-line grep** for `.optional().default(` — the AST rule catches all eight.

### `optional-then-nullish-coalesce-in-transform` — 2 sites · inert

`packages/bot/src/integrations/ships.ts:49,57` — `alreadyExists: z.boolean().optional()` in the shape plus `alreadyExists ?? false` in a downstream `.transform()` **is** `.default(false)`. Verified identical across omitted/true/false/null.
**Subtlety the rule must encode:** you must also switch `looseObject` → `object`, not just add the default — the transform was silently stripping the passthrough keys `.looseObject()` let in, and plain `z.object()` reproduces exactly that (tolerate unknown keys on input, drop them from output). `deleteResponseSchema` still needs its transform for the `ok` → `deleted` rename, so it shrinks to a pure rename rather than disappearing.

### `coerce-number-for-env` — 2 sites · validation

**Wrong:** `packages/bot/src/env.ts:44` — `PORT: z.coerce.number().int().positive().default(8080)`; `packages/agents/agent/env.ts:40` — `SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional()`.
**Right:**

```ts
const stringToInt = z.codec(z.string().regex(z.regexes.integer), z.int(), {
  decode: (s) => Number.parseInt(s, 10), encode: (n) => n.toString(),
});
PORT: stringToInt.check(z.positive()).default(8080),
```

**Buys:** two problems. **Type:** `z.input<typeof z.coerce.number()>` is `unknown` (confirmed with tsc — a Symbol is assignable), so every coerce site silently erases its input type, which is precisely what `no-type-erasure` exists to stop. **Accepted set:** `Number()` is far looser than an env var warrants — measured, `PORT` today accepts `"0x1F"`→31, `"1e3"`→1000, `" 8080 "`→8080, `true`→1; and `z.coerce.number()` alone accepts `""`→0, `null`→0, `[]`→0. For the sample rate, `Number("")` is 0 and `Number(" ")` is 0, so an empty/whitespace value maps to **tracing silently OFF** rather than undefined (`emptyStringAsUndefined: true` covers exact-empty but **not** `" "`).
**⚠ Recorded drift on the applied fix:** `z.regexes.number` is `/^-?\d+(?:\.\d+)?$/`, which **requires a leading digit**. `SENTRY_TRACES_SAMPLE_RATE=".5"` (was 0.5) and `"1e-3"` (was 0.001) are now rejected. Both env files agree on this pattern, so the narrowing is at least consistent; `.env.example:77` ships `0.1`, which parses. If you widen it, widen both sides.
**Detection:** any `z.coerce.number()` used as a property value inside a `createEnv` `server` object. The `.int()` variant is the highest-confidence subset. Make the `number-int-method` rule exclude it explicitly.

### `sentry-sample-rate-hand-parse` — 4 sites · validation

**Wrong** — `packages/agents/agent/instrumentation.ts:12,22` and `packages/bot/src/instrument.ts:3,13`:

```ts
const sampleRate = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1");
tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0.1,
```

**Right:** a schema owning the range and the fallback, with `.catch(0.1).default(0.1)`.
**Buys:** **the same variable has two parsers that disagree, and the loose one wins at runtime.** Ran both: `SENTRY_TRACES_SAMPLE_RATE=2` is REJECTED by `agents/agent/env.ts:40` at boot (correct) but passes `Number.isFinite(2)` at `instrumentation.ts:22` and ships a **200% sample rate** to Sentry. `-0.5` behaves the same. A blank value yields 0 (tracing off) where the schema yields undefined. The `Number.isFinite(x) ? x : fallback` idiom **is** `.catch(fallback)`.
**Migration caveat:** these files run before/around SDK init and deliberately avoid importing the env singleton — importing it would put full-environment validation ahead of `Sentry.init` and would hand back an unvalidated string under `SKIP_ENV_VALIDATION=1`. The fix is either to import it or to export the single field schema, but they must not keep a second parser. The bot side was fixed with a local schema for exactly this reason.
**Detection:** `Number(…)` whose argument is a `process.env[<string>]` MemberExpression (optionally via `??`), OR a `ConditionalExpression` whose test is `Number.isFinite(<id>)` and whose consequent is that same identifier. Either half is a hit; both in one file is high confidence.

### `hand-rolled-required-env-guard` — 7 sites · judgment

**Wrong** — `packages/shared/scripts/ops-inspect.ts:104`:

```ts
const url = process.env["UPSTASH_REDIS_REST_URL"];
const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL and token are required");
```

**Right:** one `z.object({…}).parse(process.env)` in a shared module (`packages/shared/src/env/scripts.ts` now exports `redisEnv()` / `tursoEnv()`).
**Buys:** seven independent re-implementations of validation two zod schemas already express, none agreeing on strictness. All use `!value` truthiness (which happens to match `emptyStringAsUndefined` + `.min(1)`, so a schema is a drop-in) but **none validate that the URL is a URL**, which the env schemas do. `sandbox-admin.ts:22-26` even builds a generic `requiredEnvironment(name)` helper — a zod schema with worse messages: it reports one missing variable at a time where `.parse(process.env)` reports all of them at once. These scripts touch production Redis/Turso.
**Sites:** `shared/scripts/ops-inspect.ts:104,173` · `release-check.ts:50` · `verify-database.ts:8` · `agents/scripts/sandbox-admin.ts:23` · `shared/drizzle.config.ts:14` (a third spelling: `url === undefined || url === ""`) · `bot/src/framework/register.ts:50`.
**Detection:** `IfStatement` whose test is `!x` / `x === undefined` / `x === ""` (or a logical combination) where `x` traces to a `VariableDeclarator` initialized from `process.env[<string>]`, and whose consequent throws or sets `process.exitCode`. Restrict to files that do **not** import an `env.ts`.
**Must not flag:** `packages/shared/drizzle.config.ts:14` — its own header documents that drizzle-kit runs as a CLI outside the application and reads `process.env` directly by design; routing it through a package module also risks the drizzle-kit loader.

### `argv-regex-test-outside-zod` — 4 sites · inert

**Wrong** — `packages/shared/scripts/ops-inspect.ts:95,98`:

```ts
if (continuation !== undefined && (continuation.length > 256 || /[\r\n]/u.test(continuation)))
  throw new Error("continuation key is invalid");
if (dispatch !== undefined && !/^[A-Za-z0-9_-]{1,128}$/u.test(dispatch))
  throw new Error("dispatch id is invalid");
```

**Right:** `z.string().max(256).regex(/^[^\r\n]*$/u)` and `z.stringFormat("dispatch_id", /^[A-Za-z0-9_-]{1,128}$/u)`.
**Buys:** validation rules on untrusted CLI input to a script that reads production Redis, expressed as imperative regex tests with hand-written throw messages. Verified the zod forms match exactly (256 pass, 257 fail, embedded newline fails, `abc-123_X` passes, `a b` fails with `invalid_format`), and the schemas become reusable at the other boundaries that consume the same ids.
**Sites:** `ops-inspect.ts:95,98` · `agents/scripts/sandbox-admin.ts:105` (`/^[1-9]\d*$/` plus a redundant `Number.isSafeInteger` — one `stringToInt` codec) · `shared/scripts/release-check.ts:17` (`requireImage`, covered by the shared `vcrDigestImage`). Also `code/tools/post_finish.ts resolveHeadCommit` (`/^[a-f0-9]{40,64}$/u.test`).
**Detection:** `<RegExpLiteral>.test(<id>)` inside an `IfStatement` test whose consequent throws or calls a `usage()`-style never-function, in a file that imports zod or lives under `scripts/`. Also flag `<id>.length > <number>` in the same position.

---

## G. Parse idioms and the type↔schema boundary

### `double-tool-input-validation` — 1 site, 659 tools · inert · **not applied; blocks two other patterns**

**Wrong** — `packages/agents/agent/lib/policy/domain-runtime.ts:336`:

```ts
const parsed = spec.input.safeParse(input);      // input was ALREADY parsed with spec.input
if (!parsed.success) { return { ok: false, error: { tag: "InvalidInput", … } }; }
```

**Chain verified end-to-end:** `subagents/*/tools/catalog.ts:22` passes `inputSchema: spec.input` to eve's `defineTool` → `eve/dist/src/harness/tools.js` forwards to `ai`.tool() → `ai@7.0.55` `doParseToolCall` (`dist/index.js:3928`) does `safeParseJSON({text, schema})` and hands `parseResult.value` (the **output**) to execute.
**Buys:** removes one full schema evaluation per tool call across **659 registered tools** (591 registry entries + 68 discord ops). The `!parsed.success` branch is dead code for model-driven calls — `ai@7.0.55` throws `InvalidToolInputError` before `execute` runs, and `executeTool` has no other caller (grepped: only the 11 catalogs).
**It is inert today only by luck.** Proved that double-parse is not idempotent for a strictObject whose transform adds a key: `z.strictObject({a,b?}).transform(v => ({...v, c:1}))` parses `{a:"x"}` to `{a:"x",c:1}`, and re-parsing that fails `unrecognized_keys`. The sole transform-bearing tool input (figma `modify_variables`) happens to prune keys rather than add them — reconstructed and confirmed the round-trip.
**Why it matters beyond performance:** it makes every `z.codec` / `.transform()` on a tool input **impossible**, which is what blocked `iso-string-to-date-by-hand` in two separate areas. Tool output is also walked twice (`domain-runtime.ts:290 assertToolOutput`, then `guardToolExecution` → `assertToolOutput` again in all 11 catalogs).
**Detection:** not a general rule — a one-site invariant. Ship it as a **regression guard instead**: assert that every tool `input:` schema is parse-idempotent (`schema.safeParse(schema.parse(sample)).success`) for as long as the re-parse exists. Several areas already added exactly this smoke test.

### `throwing-parse-on-provider-response` — 13 sites · inert

**Wrong** — `packages/agents/agent/subagents/github/lib/projects.ts:132`:

```ts
const { organization } = listOrgProjectsResponseSchema.parse(await octokit().graphql(…));
```

**Right:** safeParse + `throw new UpstreamError({ service, status: 502, detail: \`invalid response: ${z.prettifyError(parsed.error)}\` })`— the exact shape`cms/lib/client.ts:200-203`already uses.
**Buys:** corrects the prior framing — these do **not** crash.`Result.tryPromise`catches the ZodError, but`httpStatusOf` (`shared/src/errors.ts:210-221`) finds no `status`on a ZodError, so`standardFailure`classifies upstream **schema drift** as`UpstreamError{status: 500}`— indistinguishable from a real provider 500, therefore mis-triaged and mis-retried. Worse,`detail`becomes`ZodError.message`, which in 4.4.3 is the raw pretty-printed JSON issue array, and that whole blob is handed to the model as the tool result. 502 is the correct class for a bad upstream body.
**Sites:** `github/lib/projects.ts:132,160,189,256`·`sentry/lib/client.ts:68,100`, `base.ts:91`, `issue-management.ts:131`·`shopping/lib/client.ts:66`·`github/lib/base.ts:133`·`finance/lib/client.ts:68`·`outreach/lib/client.ts:33`·`shared/src/bot/generation.ts:43`(**not** inside a tool — it throws out of`resolveBotBaseUrl`, called on the request path by `channels/discord.ts:75,810`and`schedules/dispatch.ts:50`).
**Detection:** `<schema>.parse(…)`where the argument is`await response.json()`, an `await`of an SDK call, or a`.graphql(…)`result — i.e. a network payload — inside a`defineTool` `execute`or a client helper.
**⚠ Wave-level caveat the rule should carry:**`httpStatusOf(UpstreamError{502})`→ 502 ≥ 500 →`standardFailure`produces`Transient`("A failure a later attempt could plausibly survive. Retryable."). So a **deterministic, permanently-failing** payload is now reported to the model as retryable, inviting a loop. The fix is either a`mapFailure`on the domain runtimes that keeps a schema mismatch non-retryable, or a status below 500 for schema failures — decide once for the whole wave, not per-area.
**Must not flag:**`sentry/lib/client.ts:68,100`when the schema is`z.json()`applied to`await response.json()`— a value from`JSON.parse` is always a JSON value, so the parse cannot fail.

### `looseobject-parse-as-field-cast` — 10 sites · validation

**Wrong** — `packages/agents/agent/subagents/sentry/lib/base.ts:50`:

```ts
const projectProjectionSchema = z.looseObject({ status: z.string().nullish() });
data.map((project) => ({ …, status: projectProjectionSchema.parse(project).status }))
```

**Right:** `z.looseObject({ status: z.string().nullish().catch(undefined) })`.
**Buys:** these ten schemas are not contracts, they are **field-extraction shims** around Sentry SDK types that lack the field. `.parse()` gives them contract semantics they were never meant to have — verified `z.looseObject({status: z.string().nullish()}).parse({status: 3})` throws, and `.catch(undefined)` makes it return `{status: undefined, ...rest}` with every other key preserved. **Six of the ten sit inside a `.map()`** over a provider array (`base.ts:50`, `monitors.ts:40`, `members.ts:44`, `releases.ts:172`, `replays.ts:44`, `alerts.ts:215`), so ONE element with a drifted field type fails the whole `list_*` tool call — the model gets a 500 instead of N−1 good rows.
**Sites:** `sentry/lib/base.ts:50,136` · `members.ts:44,79` · `alerts.ts:149,215` · `monitors.ts:40` · `releases.ts:172` · `replays.ts:44` · `membership.ts:45`.
**Detection:** `.parse(<ident>)` on a `z.looseObject({…})` schema whose declared shape has ≤2 keys and whose result is immediately member-accessed for one of those keys. Highest priority when inside a `.map()` callback.
**Must not flag:** a `.parse()` that validates a value read back **from** the provider before echoing it into a **write** body — `sentry/lib/alerts.ts:149 issueAlertActionMatchSchema` is correct as a throwing parse, because a value outside `[all, any, none]` means the write would be wrong and adding `.catch` would silently rewrite the user's alert rule.
**Do not tighten these into real contracts.** They are provider response projections and Sentry adds fields. Where the projection is a `z.unknown()` field, keep it un-failable: `z.json()` without `.catch()` converts a field that could **never** fail into one that can (two such regressions were caught and fixed in review at `releases.ts author` and `membership.ts role`).

### `record-string-unknown` — 10 sites · validation · **⚠ has a model-facing cost**

**Wrong:** `filter: z.record(z.string(), z.unknown()).optional()` · **Right:** `z.record(z.string(), z.json())`.
**Buys:** `z.record(z.string(), z.unknown())` infers exactly `Record<string, unknown>`, the type the project's own rules ban — the ban is being routed around through zod. The repo already has the right answer twice (`notion/lib/notion-input.ts:32-34` and `outreach/lib/notion-input.ts:11-13`), so this is 10 sites that missed an established local pattern. Measured: `z.unknown()` emits `additionalProperties:{}` and accepts a **function** as a value; `z.json()` rejects it.
**Sites:** model-facing — `outreach/lib/deals.ts:19`, `outreach/lib/contacts.ts:15`, `sentry/lib/alerts.ts:82,85,131,132`, `notion/lib/blocks.ts:94`. Internal parse — `lib/core/global-config.ts:4`, `vercel/lib/edge.ts:220`, `check-capabilities.ts:120`.
**⚠ The cost, verified after the fact:** `z.json()` is self-referential, so `z.toJSONSchema` emits a recursive `$defs`/`$ref` document — and this survives **every** conversion option the AI SDK uses (draft-7 and 2020-12, `reused:'inline'` and `'ref'`); inlining cannot remove a genuine cycle. Converting all 659 tool inputs: **exactly 15 now contain `$ref` and none did at HEAD** (sentry `create_alert_rule`, `update_alert_rule`, `update_issue`; 12 in notion/outreach). Runtime acceptance is unchanged for anything arriving via `JSON.parse` (the only divergence, `{k: undefined}`, is unreachable from a JSON tool call). Whether recursive `$ref` in tool parameters survives the configured gateway model is a **single cross-cutting decision** — the justification originally written ("Anthropic accepts $ref/$defs") is stale in this tree, where `sentry/agent.ts` sets `deepseek/deepseek-v4-flash-0731` and `code/agent.ts` sets `openai/gpt-5.6-luna`.
**Detection:** `z.record` with exactly two arguments, arg0 `z.string()` and arg1 `z.unknown()`. Autofix to `z.json()` only inside a tool `input:` subtree; report-only at `.parse()` call sites.
**Must not flag:** `vercel/lib/edge.ts patch_global_config_items.value` was deliberately left as `z.unknown().optional()` for the `$ref` reason above, and because `z.json()` would pull `null` into the inferred type.

### `parse-as-type-cast` — 6 sites · inert

**Wrong** — `packages/agents/agent/subagents/vercel/lib/edge.ts:220` and `agents/scripts/check-capabilities.ts:110,113,115,118,120`:

```ts
const skillModule = z.record(z.string(), z.unknown()).parse(await import(…));
const baseTools = z.array(z.string()).parse(skillModule[`${constant}_BASE_TOOL_NAMES`]);
```

**Right:** name the fields — a real projection, or one `z.looseObject({ [`${constant}_BASE_TOOL_NAMES`]: z.array(z.string()), … })` (computed keys work fine in a zod object literal, verified).
**Buys:** `z.record(z.string(), z.unknown()).parse(x)` accepts every non-null object and infers exactly `Record<string, unknown>` — a **zod-shaped laundering of a banned construct**: it passes lint, provides no validation, tells the reader nothing, and costs a full runtime walk to learn nothing. The `check-capabilities` variant then does a _second_ `.parse()` per expected export; one `looseObject` collapses three parses into one and — the actual win — names the missing export in the error (`GITHUB_BASE_TOOL_NAMES: Invalid input: expected array, received undefined`) instead of an anonymous message. This is a CI gate that fires when someone forgets an export, so the path _is_ the message.
**Applied only at `edge.ts:220`,** where the SDK models the body as `{token, id}` and the projection `{ id: result.id, note }` is provably identical output — strictly safer, since an explicit projection cannot leak a future secret-bearing field.
**Why the `check-capabilities` sites were left:** the `looseObject` rewrite needs computed keys, which TS infers as a string index signature; under `noUncheckedIndexedAccess` every read then returns `| undefined`, trading one honest record for dead `?? []` guards. The values are also genuinely heterogeneous non-JSON (Zod schemas, functions), so neither `z.json()` nor a concrete shape applies.
**Detection:** literally `z.record(z.string(), z.unknown())` followed by `.parse(`. Near-zero false positives — it is never the schema you actually want.

### `safeparse-success-as-boolean-predicate` — 6 sites · inert

**Wrong** — `packages/bot/src/agent/client.ts:167,171`:

```ts
function isWireResponse(value: unknown): value is WireResponse {
  return wireResponseSchema.safeParse(value).success;
}
if (!isWireResponse(value) || !value.ok) throw invalidWireResponse(status);
return { sessionId: value.sessionId, continuationToken: value.continuationToken }; // reads the UNPARSED value
```

**Right:** keep `parsed` and read `parsed.data`.
**Buys:** `safeParse` already produced the narrowed, coerced value; discarding `parsed.data` and re-reading the raw input means every downstream read is a type-level assertion the compiler took on faith from the predicate. It also loses anything the schema would have applied (defaults, key stripping, transforms) — correct today only because these schemas are transform-free. `client.ts` is the worst case: `isWireResponse` ran at line 115 **and again** at line 150 on the same body, so every agent response was schema-validated twice and then read from the unvalidated original.
**Sites:** `bot/src/agent/client.ts:167,171` · `notion/lib/notion-input.ts:117` · `outreach/lib/notion-input.ts:37` · `agents/agent/lib/bot/supervisor.ts:516` · `code/hooks/audit.ts:94`.
**Detection:** a function whose entire body is `<schema>.safeParse(<param>).success` and whose return type is `<param> is T`; then flag every call site where the guarded identifier is member-accessed afterward.

### `dead-guard-after-parse` — 3 sites · inert

`finance/lib/client.ts:89` — `if (!Array.isArray(batch) || batch.length === 0) break;` where `batch` came out of `hcbGet(…, z.array(schema))`, which ends in `schema.parse(…)`. `Array.isArray(batch)` can never be false, and its presence tells the next reader that `hcbGet` might return a non-array. Same shape at `notion/lib/notion-input.ts:117` and `outreach/lib/notion-input.ts:37`, where `isRecord(value)` duplicates the object check `z.record(z.string(), …)` performs anyway.
**Detection:** an `Array.isArray(x)` / `isRecord(x)` / `typeof x` test where `x`'s declarator is a `.parse()` result whose schema head is `z.array(`/`z.record(`/`z.object(`. Worth catching because each dead guard is a standing invitation to add a `typeof` next to it.

### `handrolled-predicate-instead-of-schema` — 6 sites · inert

**Wrong** — `packages/shared/src/conversations/admission.ts:69-97`:

```ts
const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
if (typeof value !== "object" || value === null || !("status" in value)) throw new Error(…);
if (status === "start" && "admissionAttemptId" in value && typeof value.admissionAttemptId === "string") { … }
```

**Right:** `z.discriminatedUnion("status", […])` + `z.output<typeof schema>`, decoded through `stored(schema)`.
**Buys:** these are the files where the oxray rules concentrate, and a schema is the mechanical fix the rule text itself asks for. Measured with `bunx oxlint`: **137 violations total (106 `no-typeof` + 31 `no-type-erasure`); these six files hold ~28** — `notion-input.ts` alone is 9+9, `outreach/notion-input.ts` 3+6, `admission.ts` 4, `supervisor.ts parseLease` 5. Every one is a hand-rolled decoder for a value of unknown provenance, which is exactly what a discriminated union + `z.output` expresses in a tenth of the lines, with the TS type **derived** from the schema instead of hand-written beside it.
**Sites:** `notion/lib/notion-input.ts:112-223` · `outreach/lib/notion-input.ts:31-70` · `shared/src/conversations/admission.ts:69-97` · `agents/agent/lib/bot/supervisor.ts:479-501` · `bot/src/agent/client.ts:170-172` · `shared/src/conversations/keys.ts:39-42,68-71`. Also `agents/agent/channels/discord.ts:749` (`typeof value === "number" ? value : Number(value)` + `Number.isSafeInteger` → `z.union([z.int(), stringToInt]).check(z.positive())`) and `shared/src/errors.ts httpStatusOf`.
**The notion ones need the zod-4 recursive-getter form** (`z.object({ get and() { return z.array(Self) } })`) because the Notion filter grammar is recursive; that is _why_ they were hand-rolled and it is no longer a reason.
**Detection:** the `no-typeof` rule already flags the symptom. This rule's job is to supply the zod fix as the **suggestion**: a `typeof <id> === "object"` / `"in" <id>` ladder inside a function returning `x is T` or building a typed literal.
**Must not flag — five families where a schema is genuinely the wrong tool:**

- `agents/agent/lib/http/query.ts` (6 sites) — `stringifyQueryValue` is a **total function over every JS runtime type** (symbol, bigint, object, primitive), not a validator. A zod union would be slower, longer, and still need a fallthrough.
- `lib/core/{serialization,runtime,json}.ts`, `lib/discord/{state,input-requests}.ts`, `lib/policy/{audit,provider-redaction}.ts` (26 sites) — recursive walkers over the `JsonValue` union. The `typeof` branches **discriminate the union during traversal**, not validate an input.
- `discord/lib/rest.ts:58,68` — converting to `z.looseObject({}).safeParse(v).success` trades one flagged pattern for another (`safeparse-success-as-boolean-predicate`), because the function must return the _original_ value asserted to the endpoint's v10 result type; parsing properly would clone every REST payload and change object identity.
- `bot/src/framework/dedup.ts:37` — `typeof claimed.error` produces a **type-name string** for an observability label. A schema does not express that.
- `agents/agent/lib/bot/supervisor.ts:390,403` — `validateBotEnv` reports per-key diagnostics ("contains an invalid variable name: X") that map onto a typed `InvalidBotSandboxConfig`; a `z.record` rewrite flattens those into generic issue paths.
  **⚠ And one hard constraint discovered in review:** do **not** suggest `z.json()` / `z.array(z.json())` in a guard that must never throw. In `code/hooks/audit.ts` the recursive walk raised `RangeError: Maximum call stack size exceeded` on cyclic and 20k-deep input, and the trailing `.catch("object")` did **not** intercept it — `.catch` supplies a fallback for validation issues, not for thrown errors. The fix was all-shallow options plus a total terminal (`z.unknown().transform(() => "object")`).

### `discarded-zod-error-detail` — 8 sites · inert

**Four different error-rendering idioms coexist and only one is canonical.**
**Wrong (a) — fully discarding**, `lib/core/web-search.ts:128`: `throw new UpstreamError({ service:"Exa", status:502, detail:"search response was invalid" })`.
**Wrong (b) — path-dropping**, `domain-runtime.ts:342`: `parsed.error.issues.map((issue) => issue.message).join("; ")`.
**Right:** `z.prettifyError(parsed.error)` — already used at `cms/lib/client.ts:202` and `bot/integrations/cms.ts:113`; it renders `✖ Invalid input: expected string, received number\n  → at status`.
**Buys:** the `.issues.map(i => i.message)` variant **drops `issue.path`**, so a 15-field payload reports "Invalid input: expected string, received number" with no indication of which field drifted — and `wire.ts:398` and `render.ts:128` hand-roll the path back in, proving the omission is unintentional rather than policy. The five fully-discarding sites replace the error with a fixed string, so an upstream drift produces a log line with **zero** diagnostic content. `domain-runtime.ts:342` is the highest-value fix: that string is what the **model** reads when a tool input is rejected.
**Sites:** `domain-runtime.ts:342` · `lib/core/audit-log.ts:128-131` · `lib/core/web-search.ts:128-131` · `lib/core/global-config.ts:54-60` · `lib/core/documentation.ts:36-43` · `bot/src/agent/render/discord-rest.ts:35-43` · `bot/src/integrations/ships.ts:70`.
**Detection:** a `!parsed.success` branch whose thrown/returned message is a `StringLiteral` or template containing no reference to `parsed.error`, OR contains `.issues.map(… => … .message)` without `.path`.
**Format caveat:** where the consumer joins issues into a one-line message (`InvalidInput` joins with `"; "`), `z.prettifyError` is multi-line — use path-prefixed lines instead, matching `shared/src/conversations/render.ts:128`.

### `zodtype-t-generic-helper` — 7 sites · inert

**Wrong:** `async function validatedJson<T>(response: Response, schema: z.ZodType<T>): Promise<T>`
**Right:** `async function validatedJson<S extends z.ZodType>(response: Response, schema: S): Promise<z.output<S>>`
**Buys:** `z.ZodType` in 4.4.3 is `ZodType<out Output = unknown, out Input = unknown, …>` (`zod/v4/classic/schemas.d.cts:6`). Writing `z.ZodType<T>` pins Output and leaves Input at `unknown`; because Input is covariant, **any** schema is assignable and its real input type is silently discarded. Live loss at `schedule/store.ts:287`: `decodeRow` is called with `taskViewRowSchema`, whose input is the raw libsql row and whose output is the transformed `ScheduledTaskView` — the `row: LibsqlRow` parameter is checked against nothing. The correct form the repo **already uses** at `finance/lib/client.ts:38,72` and `outreach/lib/client.ts:17` keeps both sides and lets callers ask for `z.input<S>`.
**Sites:** `cms/lib/client.ts:229,251,277` · `schedule/store.ts:287` · `shared/src/wire.ts:392` · `bot/src/integrations/cms.ts:90` · `bot/src/integrations/ships.ts:65`.
**Detection:** a `TSTypeReference` `z.ZodType<T>` in a parameter position where `T` is a type parameter of the enclosing function.
**Also worth recording:** the repo has **zero** `z.ZodTypeAny` (the zod-3 idiom) and **zero** `z.core.$ZodType` — the latter is only needed for helpers that must also accept `zod/mini` schemas, which nothing here does. No change warranted on that axis.

### `zodtype-annotation-instead-of-satisfies` — 3 sites · inert

**Wrong:** `const webhookEventSchema: z.ZodType<WebhookV2Event> = z.enum(["PING","FILE_UPDATE",…]);`
**Right:** `const webhookEventSchema = z.enum([…]) satisfies z.ZodType<WebhookV2Event>;`
**Buys:** type-checked with the repo's own tsc — the annotation **erases the concrete schema class**. On the annotated value `.options`, `.exclude([…])`, `.shape` and `.pick({…})` all become type errors, and `z.input<typeof x>` collapses to `unknown` (confirmed: `const b: z.input<typeof annotated> = { anything: true }` compiles). `satisfies` checks the same conformance and keeps every one of those.
**Sites:** `figma/lib/webhooks.ts:18,27` (lose `.exclude`/`.extract` against the `@figma/rest-api-spec` unions) · `lib/core/audit-log.ts:34` (loses `.shape`/`.pick`/`.omit`/`.partial` against a Drizzle `$inferSelect` row). The repo already uses `satisfies` correctly at 10 sites (`figma/lib/variables.ts`, `schedule/store.ts`) — three stragglers, not a policy question.
**Detection:** a `VariableDeclarator` with a `TSTypeAnnotation` of `z.ZodType<…>` (or `z.ZodSchema<…>`) whose initializer is a zod constructor call.

### `handwritten-type-parallel-to-schema` — 4 sites · inert

**Wrong:** `packages/shared/src/wire.ts:366` declares `export type WireResponse = {ok:true; sessionId:string; …} | {ok:false; …}` by hand, while `packages/bot/src/agent/client.ts:157` declares an **untied restatement** as a zod schema.
**Right:** `export const wireResponseSchema = z.discriminatedUnion("ok", […]); export type WireResponse = z.output<typeof wireResponseSchema>;` in `wire.ts`, imported by the bot.
**Buys:** four places declare a TS type and a zod schema for the same value with nothing enforcing agreement — the exact drift `wire.ts`'s own header says the module exists to prevent ("Both sides import these schemas, so the contract cannot drift silently"). **The two definitions already differed:** the schema required `.min(1)` on `sessionId`, the type did not; the schema lived in the bot package while the type lived in shared, so the agent (`channels/discord.ts:161,167`) was checked against the type and the bot validated against the schema.
**Sites:** `shared/src/wire.ts:366` vs `bot/src/agent/client.ts:157-164` · `shared/src/conversations/render.ts:39` vs `:22` · `bot/src/agent/render/discord-rest.ts:28` vs `:31` · `shared/src/conversations/admission.ts:69` (a type with no schema at all).
**`render.ts` has a twist worth recording:** `interface RenderProjection` is the write shape and `StoredRenderProjection = z.infer<…>` the read shape, and `storedProjection()` at `:141-144` builds the stored value by spread with **no parse** — the `: StoredRenderProjection` return annotation is asserted, not verified, so nothing validates the write path into Redis.
**⚠ A `satisfies z.ZodType<T>` guard does NOT catch this divergence** (a review finding): both schemas produce the same output _type_, so strictness and per-field constraints are invisible to it. Verified at runtime that `{ok:true, …, extra:1}` was rejected by the shared schema and accepted by the bot's local copy. Only a single declaration fixes it.
**Detection:** a `TSTypeAliasDeclaration` / `TSInterfaceDeclaration` whose member names and primitive types match, key for key, an `ObjectExpression` passed to a zod object/union constructor in the same package. Report the pair.

### `zinfer-instead-of-zoutput` — 41 sites · inert

**Wrong:** `export type Principal = z.infer<typeof principalSchema>;` · **Right:** `z.output<…>`.
**Buys:** `z.infer` **is** `z.output` (verified), so this is a naming rule, not a bug hunt — and it was checked before proposing. All 41 sites were cross-referenced against every transform-bearing schema in the repo (`figma/lib/variables.ts` ×4, `env.ts:74`, `schedule/store.ts` ×3, `bot/integrations/ships.ts` ×2) and **none** of the 41 points at one, so the rename is provably inert everywhere today and there is no lurking pre-vs-post-transform mistake to fix.
**The value is future-proofing plus consistency:** the repo was split 41 `z.infer` / 17 `z.output` / 1 `z.input`, and the sites that got it right are exactly the ones that had to think about it — `ships.ts:61-62` uses `z.output` on its two transform-bearing schemas, `finance/lib/client.ts:21` correctly uses `z.input` on the pre-default pagination shape. Standardising on the direction-explicit spellings means the next transform added to any of these 41 schemas cannot silently repurpose a type.
**Distribution:** `shared/src/wire.ts:344-360` (17) · `finance/lib` (6) · `outreach/lib` (4) · `cms/lib/client.ts:135,144` · `sentry/lib/client.ts:44,76` · plus 9 singletons.
**Detection:** `TSTypeReference` to `z.infer`. Trivial autofix.

### `unbranded-redis-key-ids` — 34 sites · inert · **not applied (cross-package)**

**Wrong** — `packages/shared/src/conversations/keys.ts:7-91`, 21 key builders over 5 id kinds, every one `(x: string) => string`:

```ts
export function pendingKey(continuationKey: string): string { return `pending:${continuationKey}`; }
export function interactionReceiptKey(interactionId: string): string { … }
export function renderTargetKey(dispatchId: string): string { … }
```

…while `wire.ts` declares `continuationKey: snowflake` and `interactionId: snowflake` — the **same schema**.
**Right:** `snowflake.brand<"ContinuationKey">()` / `snowflake.brand<"InteractionId">()` / `z.uuid().brand<"DispatchId">()`.
**Buys:** brand exactly **three** ids, not 384. `continuationKey` and `interactionId` are structurally and runtime-identically interchangeable, so `interactionReceiptKey(continuationKey)` compiles today, passes every runtime check, and silently reads the wrong Redis key — a miss that looks like a cache expiry, not a bug. Blast radius: 238 `dispatchId` references and 180 `continuationKey` references funnelling through 21 same-signature builders (8 take continuationKey, 9 take dispatchId). Verified with tsc that `.brand<"…">()` rejects both swaps, and verified at runtime that the parsed value is an ordinary string whose `JSON.stringify` is unchanged — branding is a purely compile-time overlay, zero risk.
**Why not applied:** every builder is called from `packages/agents` and `packages/bot`; branding from inside `packages/shared` alone breaks both.
**Must not flag:** the 384 `*Id` fields in tool inputs. They cross a JSON boundary to the model, are never passed positionally to our own multi-id functions, and branding them adds noise for no caught bug.
**Detection:** ≥3 exported functions in one module with the identical signature `(x: string) => string` whose parameter names differ and map to distinct zod field declarations elsewhere. This is a report-only architectural rule.

---

## 3. Patterns deliberately NOT enforced

A rule that fires on any of these is a false positive. Several were verified specifically to rule them out.

**1. `z.enum(SOME_VARIABLE)` inference degradation — 0 of 14 sites.** The worry is unfounded here. All 14 identifier-argument sites (`vercel/lib/projects.ts:153,154,180,181`; `cms/lib/users.ts:89,111`; `service_accounts.ts:92,115`; `lib/core/web-search.ts:34`; `lib/core/audit-log.ts:28,38,39,42,46`) resolve to `as const` tuples or `as const` / `as const satisfies X` objects. All three shapes were type-checked with `bunx tsc --strict` against the repo's own zod and each infers the exact literal union. A bare `["a","b"]` with no `as const` is the only shape that collapses to `string`, and the repo has none. **Fire only on a non-`as const` array-literal identifier.**

**2. `as const` maps mirroring an inline `z.enum` two lines away.** `guild.ts` `EVENT_TYPES`/`EVENT_STATUSES`/`AUTO_MOD_*` and `roles-channels.ts` `CHANNEL_TYPES`/`AUTO_ARCHIVE_DURATIONS`. Drift was checked and is **not possible** — `CHANNEL_TYPES[input.type]` already fails tsc if the enum gains a member the map lacks. No rule warranted.

**3. `lib/core/audit-log.ts:14` duplicating `AuditDecision` from `@repo/shared/db`.** Deliberate, with an `as const satisfies AuditDecisionValues` guard and a comment explaining that it avoids loading native libSQL through the barrel. The `satisfies` fails tsc on drift. Do not "fix".

**4. `z.string().min(1)` for secrets is the correct zod 4 idiom.** `.nonempty()` still exists but is a pure alias — identical accept set and identical JSON Schema `minLength: 1`. No rule.

**5. `z.looseObject` on provider responses — 23 sites, all correct.** `github/base.ts`, `sentry/*`, `bot/ships.ts`. Leave them.

**6. `.readonly()` on env fields buys nothing.** Verified the object t3-env returns is **not** frozen (`env.A = "x"` succeeds), and field-level `.readonly()` on a string is a no-op.

**7. Do not replace `serialization.ts`'s hand-rolled JSON walker with `z.json()`.** `z.json()` stack-overflows on cyclic input instead of producing a clean issue, and accepts `-0`.

**8. `figma/lib/client.ts:57` and `discord/lib/rest.ts` transport casts.** Single documented, already-`oxlint-disable`d assertions at one transport boundary. Adding runtime response validation there would create a _new_ provider-response projection — exactly the class that starts rejecting live payloads.

**9. `linear` role vocabulary is deliberately not the SDK enum.** `UserRoleType` is `{Admin, App, Guest, Owner, User}`; the tools expose `"admin"|"member"|"guest"` and map `member → UserRoleType.User`. Adopting the SDK enum would expose `app`/`owner` to the model and rename `member`. Contrast `InitiativeStatus`/`ProjectUpdateHealthType`/`InitiativeUpdateHealthType`, where the value sets were byte-identical and the hand-written maps _were_ deleted.

**10. `z.hostname()` where wildcards are legal.** Applied to 14 Vercel domain fields, but **reverted** on `security.ts list_bypass_ips.domain` and never applied to `domains.ts issue_cert.cns` — a wildcard CN (`*.purduehackers.com`) is the normal case and `z.hostname()` rejects the leading `*`.

**11. Undocumented provider id/format fields.** Figma file keys, node ids, component keys and pagination cursors; Notion ids (dashed **and** bare 32-char hex are both accepted, and `page_id` is documented as "UUID or URL"); Linear ids (`retrieve_entities` explicitly accepts "ID, identifier (e.g. TEAM-123), or URL"); Sentry `trace_id`; Amazon ASIN; GitHub logins and team slugs. Naming a guessed regex converts a permissive field into an outage surface for zero information gain.

**12. `z.emoji()` is not a single-emoji check.** `bot/src/commands/hack-night.ts:47` deliberately requires **exactly one** pictographic character; `z.emoji()` matches one _or more_, so substituting it would let `🌙🌚` rename the busiest channel in the server.

**13. Free-form / open-vocabulary fields.** CMS `event_type` (Payload's `eventType` is open text), Notion `properties` (workspace-defined), Outreach `stage` (an exact Notion status-option label). Enumerating what you can see today rejects values the upstream itself accepts.

---

## 4. What was skipped, and why

Sites where the canonical form would have changed behavior on data we do not control, or across a deployment boundary.

**Provider response projections — the single largest exclusion.** 228 of the 1,347 bare `z.string()` sites sit in projection files. Tightening them converts an upstream format change into a hard parse failure mid-tool-call.

- **Payload CMS** (`cms/lib/client.ts`, `bot/src/integrations/cms.ts`): `url`/`thumbnailURL` stay `z.string()` — Payload's local-storage adapter returns **relative** paths (`/api/media/file/<name>`), which `z.url()` rejects. `createdAt`/`updatedAt`/`start`/`end` stay strings. `roles` stays `z.array(z.string())` — the role list is owned by `purduehackers/cms` and can gain a member before this repo learns of it. `email` stays `z.string()` — historical rows hold whatever the CMS once accepted.
- **HCB** (`finance/lib/*`): `email`, `created_at`, `due_date`, `paid_at`, `spent_at`, `date`, `website` all stay `z.string()`. HCB's public v3 API guarantees neither RFC-conformant emails nor ISO-8601 timestamps.
- **SerpAPI** (`shopping/lib/client.ts`): `link`, `link_clean`, `thumbnail` stay strings — SerpAPI routinely returns protocol-relative and tracking-wrapped URLs.
- **Hunter** (`outreach/lib/enrichment.ts`): `data.email` stays `z.string().nullable()` and `sources[].uri` stays `z.string()` — Hunter's entire job is returning addresses of unknown validity, so `z.email()` there turns a normal "unverified address" answer into a 502.
- **grep.app** (`github/lib/base.ts`), **Exa** (`lib/core/web-search.ts` `publishedDate`/`image`/`favicon`/`autoDate`), **Sentry** (`firstSeen`/`lastSeen`/`dateCreated`/`permalink`), **GitHub GraphQL** `fieldValues[].date`/`.number` (`ProjectV2ItemFieldNumberValue.number` is a **Float**, not Int) — all left as-is.

**Rolling-deploy boundaries.** `shared/src/bot/{generation,health}.ts` and `conversations/render.ts` stay `z.object`, not `z.strictObject`: an older deployable reading a newer writer's record, or a release probe reading a newer bot's `/health`, would turn an additive field into a failed readiness probe or an undecodable active generation. Same for `bot/src/agent/turn-messages.ts`. This was also the one **caught drift**: the new `wireResponseSchema` shipped as `strictObject` and had to be reverted to `z.object`, because the agent (Vercel) and bot (pinned Sandbox image) deploy independently and an additive field on the acknowledgement would make every older bot reject a successful turn.

**Cross-package edits an area agent could not make.** `unbranded-redis-key-ids` (21 builders called from both consumer packages) · `superrefine-emulating-discriminated-union` on `wire.ts:96`/`:170` (makes `MessagePayload` a union; `channels/discord.ts:400-401` reads `payload.scheduleId` with no narrowing) · the `activatedAt`/`expiresAt` codec cluster (flipping the field to `Date` is a type change in two areas at once) · `env.ts:78` image-digest anchoring (tightening only the agent side would make it refuse a `BOT_IMAGE` the supervisor's own generation record still accepts).

**Blocked by the double-parse.** Every `z.codec` / `.transform()` on a tool input — see `double-tool-input-validation`. Three independent areas hit it and all backed out.

**Deliberate non-tightenings on values we own but cannot trust.**

- `wire.ts authorizationChallenge.expiresAt` stays a bounded string — it comes from a third-party device-authorization provider and its producer (`channels/discord.ts:225`) only guarantees `Date.parse`-ability, not ISO 8601.
- `schedule/store.ts memberRoles` stays `z.array(z.string())`, not `z.array(discordSnowflake)` — the column is an advisory creation-time snapshot, and `claimDueTasks` aborts the entire batch on the first undecodable row, so one odd role id would stall the dispatcher.
- `policy/engine.ts` `principal.userId` stays `z.string().min(1)` — scheduled and non-Discord principals flow through `decideCapability`, and a fail-closed policy engine that rejects its own input is worse than a loose one. `budget.used`/`limit` stay `z.number()` — nothing guarantees token counts are integral.
- `agents/agent/env.ts secret` did **not** get `.trim()` — the bearer secrets are compared against a copy parsed by `packages/bot/src/env.ts`, and trimming one side only breaks constant-time bearer matching for any secret carrying stray whitespace.

**Two open items flagged but not fixed, for the record:**

1. `notion/lib/pages.ts cover: z.url()` rejects `""`, which `parseCover`'s `if (!cover) return undefined` explicitly supports — a model emitting `cover:""` for an optional field now fails the whole `create_page` call. Adjacent `icon` was correctly left as `z.string()` for the identical reason, so the two fields are now inconsistent. Fix: `z.union([z.url(), z.literal("")])`.
2. `outreach/lib/deals.ts close_date: z.iso.date()` rejects a full ISO datetime, which Notion's date property accepts in `date.start`. The `.describe()` already said YYYY-MM-DD, so the datetime path was undocumented. Fix if it matters: `z.union([z.iso.date(), z.iso.datetime()])`.
