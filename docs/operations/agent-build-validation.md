# Agent build memory and artifact validation

The Eve 0.81 candidate previews for PRs [191](https://github.com/purduehackers/wack-hacker/pull/191)
and [192](https://github.com/purduehackers/wack-hacker/pull/192) exhausted the
4-core, 8 GB Vercel builder. Repository validation passed. A successful local
compile does not establish that this deployment failure is fixed.

## Candidate

`bun run build` still runs the installed Eve CLI under Node, as required by the
repository's toolchain. The agent package passes Node a 3072 MiB old-space ceiling
for that build process only. It preserves inherited `NODE_OPTIONS`, including
conditions and import settings. It does not set a deployment environment variable
or change the deployed server's heap.

This is a bounded-memory candidate for remote verification. Node's old-space
ceiling is not a total process limit: young-generation allocations, native
Rolldown allocations, child processes, and the rest of the builder use additional
memory. It must not be described as a verified fix until the full Vercel preview
build succeeds on the same builder.

## Local investigation

Runs used the PR 192 base (`74c57d5`), before the routing, replay, and task-control
layers, with Node 24.19.0 on macOS arm64, Vercel output, and
`SKIP_ENV_VALIDATION=1`. The commands supplied both feature variables as the string
`false`. Skipping validation leaves raw strings, so those values were truthy:
**these profiles exercised the catalog and durable provider, not default-off
selection.** The 3072 MiB output's emitted manifest confirms
`providerName: "wack-durable-bash"` for all 13 agents. The pre-replay branch's
original `bash` and `write_file` slots do not establish which provider was selected.

Heavy agent builds ran sequentially. These are single runs on a shared
development machine, not a latency benchmark. RSS is the maximum reported by
macOS `/usr/bin/time -l`; it is not the aggregate memory use of the Linux Vercel
builder.

All runs skipped sandbox prewarming. **Their output must not be deployed.**
They require no provider credentials and do not create native sandboxes.

| Configuration                             | Result                                    | Wall time | Maximum RSS         | Server function, including dependencies |
| ----------------------------------------- | ----------------------------------------- | --------- | ------------------- | --------------------------------------- |
| Original build                            | Passed                                    | 43.12 s   | 2,761,211,904 bytes | 51,320,477 bytes                        |
| Externalize five direct SDKs              | Passed                                    | 54.33 s   | 2,863,808,512 bytes | 58,291,178 bytes                        |
| Original dependencies, 1536 MiB old space | Failed during Nitro/Rolldown JSON parsing | 28.72 s   | 2,454,798,336 bytes | No new output                           |
| Original dependencies, 2048 MiB old space | Passed                                    | 185.00 s  | 2,601,238,528 bytes | 51,320,477 bytes                        |
| Original dependencies, 3072 MiB old space | Passed                                    | 34.70 s   | 3,080,175,616 bytes | 51,320,477 bytes                        |

The SDK experiment externalized Linear, Sentry API, Vercel, Cloudflare, and
Octokit through Eve's public `build.externalDependencies` setting. Isolated
imports of all five packages passed, but time and RSS increased, so the change
was rejected. The original SDK packaging and all integration code remain.

The 1536 MiB ceiling failed after collection still retained about 1567 MiB of
JavaScript heap. The 2048 MiB ceiling saved only 5.8% of reported RSS while taking
4.3 times as long. Neither setting is used.

The 3072 MiB candidate completed without that regression and produced the same
function sizes, but its measured RSS was higher than the baseline. These runs
establish neither a memory reduction nor a speed improvement. The candidate tests
whether a ceiling below Node's default leaves enough room for native allocations
on the Linux builder; the remote preview must decide whether to retain it.

For a credential-free hosted candidate compile from `packages/agents`, explicitly
enable the features instead of relying on the raw-string behavior:

```sh
SKIP_ENV_VALIDATION=1 \
MAIN_AGENT_CATALOG_ENABLED=true \
DURABLE_BASH_ENABLED=true \
VERCEL=1 VERCEL_ENV=preview \
bun --no-env-file run build --skip-sandbox-prewarm --profile /tmp/wack-build-profile.json
```

For default-off selection with skipped validation, both variables must be unset:

```sh
env -u MAIN_AGENT_CATALOG_ENABLED -u DURABLE_BASH_ENABLED \
  SKIP_ENV_VALIDATION=1 VERCEL=1 VERCEL_ENV=preview \
  bun --no-env-file run build --skip-sandbox-prewarm --profile /tmp/wack-native-build-profile.json
```

Check the emitted sandbox provider metadata when labeling a run native or
durable. A literal `false` environment string is insufficient when validation is
skipped. The table above contains no verified default-off profile.

Use the production Node major (24). The profile reports compiler phases and
complete raw size for each hosted function; its total includes the separate
server and workflow function copies. Do not treat the total as a single
function's size.

## Artifact gate

CI runs the isolated artifact check after its ordinary, default-off build:

```sh
bun run check:sandbox-bundle "$(command -v node)"
```

The check copies the built server outside the checkout, preserves relative
symlinks, rejects links or package resolution outside that copy, and enforces a
200 MiB function budget. With an empty environment, it executes Python/WASM and
QuickJS and checks their actual output. Fetch is disabled in the probe.

The same check accepts a hosted function directory as its second argument:

```sh
bun run check:sandbox-bundle "$(command -v node)" \
  .vercel/output/functions/__server.func
bun run check:sandbox-bundle "$(command -v node)" \
  .vercel/output/functions/.well-known/workflow/v1/flow.func
```

A full preview build must also pass with sandbox prewarming enabled, the actual
deployment environment, both hosted functions packaged, and no memory-machine
upgrade. If the build-only ceiling does not fix that run, remove the candidate
ceiling and retain the artifact gate and diagnostic evidence. Local success
does not clear the runtime migration, Discord canary, or latency release gates.
