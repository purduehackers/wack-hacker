# Agent build memory and artifact validation

The Eve 0.81 candidate previews for PRs [191](https://github.com/purduehackers/wack-hacker/pull/191)
and [192](https://github.com/purduehackers/wack-hacker/pull/192) exhausted the
4-core, 8 GB Vercel builder. Repository validation passed. A successful local
compile did not establish deployability. The capped build in PR
[197](https://github.com/purduehackers/wack-hacker/pull/197) subsequently completed
on the same builder, as recorded below.

## Build process

`bun run build` still runs the installed Eve CLI under Node, as required by the
repository's toolchain. The agent package passes Node a 3072 MiB old-space ceiling
for that build process only. It preserves inherited `NODE_OPTIONS`, including
conditions and import settings. It does not set a deployment environment variable
or change the deployed server's heap.

Node's old-space ceiling is not a total process limit: young-generation
allocations, native Rolldown allocations, child processes, and the rest of the
builder use additional memory.

## Remote verification — 2026-10-20 UTC

At commit `659b05661e7a4bae31df78286fe413a88d87d0ab`, the
[Vercel preview](https://vercel.com/purdue-hackers/wack-hacker-v2/DfdtHcpkggvfTqAoy87Y4RZguFqY)
reached **READY** on the unchanged 4-core, 8 GB builder. Its logs confirm
`node --max-old-space-size=3072 node_modules/eve/bin/eve.js build`, initialization
of all 13 sandbox templates, a 12,795 ms Nitro server build, and a Nitro-reported
size of 51.8 MB. Turbo completed in 1m52.967s and Vercel reported
`Build Completed in /vercel/output [2m]`.

The uncapped previews for PRs [194](https://github.com/purduehackers/wack-hacker/pull/194),
[195](https://github.com/purduehackers/wack-hacker/pull/195), and
[196](https://github.com/purduehackers/wack-hacker/pull/196) all exhausted memory.
The last reported an OOM event, SIGKILL, and exit 137 after 7m25.834s in Turbo.
This comparison supports retaining the build-only ceiling. One successful capped
preview is not causal proof of memory savings or a production latency measurement.

The [Linux validation job](https://github.com/purduehackers/wack-hacker/actions/runs/39399504410/job/118550391898)
passed formatting, strict lint with zero warnings/errors, 222 tests with zero
failures, and the bot Docker build. Redis-dependent tests were skipped there;
separate local validation passed all 259 tests against real Redis. The isolated
Linux artifact probe passed CPython/WASM and QuickJS for all 13 agents in native
mode on Node 24.21.0, with 51,627,638 artifact bytes. Migration review and Socket
checks also passed at this head.

Separate local validation with validated environment values passed the combined
durable-mode build and emitted replay probe on Node 24.19.0: all 13 agents and a
51,556,437-byte artifact. These checks establish preview build and packaging
success, not production rollout, a Discord canary, or runtime performance gains.

The validation job now starts a digest-pinned Redis 8.10.2 service, waits for
`redis-cli ping` health checks, and sets `REDIS_TEST_URL` only for `bun test`.
This supplies the previously skipped tests with an isolated Redis instance.
Local validation of this change passed all 259 tests and 8,975 assertions using
Bun 1.4.0 and a separate Redis 8.10.2 host process on macOS. That run verifies the
full test suite against Redis; it does not exercise the pinned Linux container.

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
on the Linux builder; the successful remote preview above supports retaining it.

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

The verified preview passed with sandbox prewarming enabled, the actual
deployment environment, a complete hosted build, and no builder upgrade.
Future changes must preserve those checks. The runtime migration, Discord canary,
and latency release gates remain separate and are not cleared by this build.
