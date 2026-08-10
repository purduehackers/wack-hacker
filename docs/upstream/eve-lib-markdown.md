# Eve rejects non-module files anywhere under `lib/`

**Status:** patched locally via `patches/eve@0.29.5.patch`. Not yet filed upstream.
**Affects:** eve 0.29.5 and 0.31.3 (verified byte-identical discovery code).

## Summary

Eve's `lib/` discovery walks the directory recursively and raises an
**error**-severity diagnostic for every file that is not an authored module.
There is no way to keep a non-module asset — a markdown document, a fixture, a
`.sql` file — next to the code that imports it, even when the bundler is
perfectly capable of loading it.

The practical effect is that a bundler-loaded asset must live outside `lib/`,
and every location outside `lib/` is either another reserved slot with its own
semantics or an unrecognized directory that emits a warning on every build.

## Reproduction

```bash
mkdir -p agent/subagents/<domain>/lib/skill_defs
echo '# hello' > agent/subagents/<domain>/lib/skill_defs/doc.md
eve build
```

```
Discovery failed with 1 error(s) and 0 warning(s).
Discovery diagnostics:
- Error: Expected ".../lib/skill_defs/doc.md" to be a supported authored module within "lib/".
  source: .../lib/skill_defs/doc.md
```

The same happens for any non-module file — we first hit it with a stray
`constants.ts.bak` left behind by an editor.

## Root cause

`dist/src/discover/lib.js` calls the shared walker without `allowMarkdown`:

```js
discoverNamedSourceDirectory({
  directoryName: "lib",
  recursive: true,
  unsupportedFileCode: DISCOVER_LIB_ENTRY_UNSUPPORTED,
  unsupportedFileMessage: (e) => `Expected "${e}" to be a supported authored module within "lib/".`,
});
```

`dist/src/discover/named-source-directory.js` then has two independent gates.
The **diagnostic** gate:

```js
if (a.unsupportedFileCode === undefined || isTypeScriptDeclarationFileName(c.name)) continue;
const u = getSupportedModuleBaseName(c.name) !== null;
const d = a.allowMarkdown && c.name.endsWith(`.md`);
u || d || a.diagnostics.push(createDiscoverErrorDiagnostic({ code: a.unsupportedFileCode, … }));
```

and the **source-collection** gate, which is what decides whether a file becomes
part of the agent graph:

```js
collectNamedSlotCandidates(entries, { allowMarkdown: t.allowMarkdown, allowModules: true });
```

Those two are conflated behind one flag. Turning `allowMarkdown` on for `lib/`
would silence the error but also promote every `.md` into a **module slot**,
where it would collide with a same-named `.ts` file and be lowered as an
authored source. That is not what an imported asset wants.

## Why the obvious workarounds do not apply

| Location                 | Result                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/**/*.md`            | error, build fails                                                                                                                              |
| `skills/*.md`            | parsed as a static skill — loses per-principal `minRole` filtering, since static skills bind at graph-resolution time before any session exists |
| `instructions/*.md`      | composed into the system prompt, wrong semantics                                                                                                |
| `tools/*.md`             | silently ignored, but every entry there becomes a tool slot                                                                                     |
| `<subagent>/skill_defs/` | `discover/unsupported-directory` **warning** per directory                                                                                      |
| outside `agent/`         | works, but separates prose from the subagent that owns it                                                                                       |

## Suggested upstream fix

Separate "may become a source" from "is allowed to exist". Either:

1. **Ignore, don't reject.** Treat unknown files under `lib/` the way `tools/`
   already treats a stray `.md` — skip them silently. `lib/` is documented as
   "import-only; not mounted into the workspace", so a file there that is not a
   module is the bundler's business, not discovery's.
2. **Add an explicit opt-out**, e.g. `ignoredFilePatterns` on the walker or a
   `lib.assets` key in agent config.

Option 1 is a one-word change and matches the existing behavior of a sibling
slot.

## Our local patch

`patches/eve@0.29.5.patch` relaxes only the diagnostic gate:

```diff
-let u=getSupportedModuleBaseName(c.name)!==null,d=a.allowMarkdown&&c.name.endsWith(`.md`);
+let u=getSupportedModuleBaseName(c.name)!==null,d=c.name.endsWith(`.md`);
```

Deliberately narrow. `collectLeafSources` still receives the unmodified
`allowMarkdown`, so a `.md` under `lib/` is **not** collected as a source, does
not create a slot, and cannot collide with a sibling module — it is simply
ignored by discovery and left to the bundler. Slots elsewhere are unaffected:
`instructions/` already passed `allowMarkdown: true`, and `tools/` passes no
`unsupportedFileCode` so it never reached this branch.

Verified after patching: `eve build` reports 0 errors and 0 warnings, no
`lib/skill_defs/*` logical path appears in the compiled manifest, and the
markdown text is inlined into `.output/server/index.mjs` by the bundler.

## Related: the bundler also needs teaching

Separately from discovery, nitro's rolldown pass parses `.md` as JavaScript and
fails with `PARSE_ERROR`. Eve exposes no bundler hook (`build` accepts only
`externalDependencies`), so `packages/agents/nitro.config.ts` supplies
`rolldownConfig.moduleTypes = { ".md": "text" }` through nitro's own c12 config
discovery, which deep-merges with the config Eve provides.

That is undocumented and could break on an Eve or nitro bump, but it fails
loudly — without it the build stops at the first `.md` import. A supported way
to register a bundler loader would remove the need for it.
