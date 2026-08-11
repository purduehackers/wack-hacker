# The bot: one always-on Bun process holding a Discord gateway connection.
#
# Host-agnostic on purpose. This image runs unchanged on Vercel Sandbox, Fly,
# Railway, or a homelab box — the bot has no Vercel imports, and its /health
# endpoint serves a container HEALTHCHECK, a platform liveness probe, and the
# agent's bot-supervisor schedule equally. Choosing a host is a deploy decision,
# not a code decision.
#
# Build from the REPOSITORY ROOT, not this directory, because the bot depends on
# the @repo/shared workspace package:
#
#   docker build -f packages/bot/Dockerfile -t wack-hacker-bot .
#
# For Vercel Sandbox the image must be linux/amd64 and pushed to VCR:
#
#   docker buildx build --platform linux/amd64 -f packages/bot/Dockerfile \
#     --output "type=image,name=vcr.vercel.com/<team>/<project>/wack-hacker-bot:$GIT_SHA,push=true,oci-mediatypes=true,compression=zstd" .
#
# Note that Vercel Sandbox does NOT run ENTRYPOINT or CMD for a custom image —
# the agent's bot-supervisor schedule starts the process with runCommand. CMD
# below is what every other host uses, and documents the intended entry anyway.

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS deps

WORKDIR /app

# Manifests first, so a source-only change reuses the install layer.
#
# Every workspace manifest is copied even though the agent is not part of this
# image: the lockfile is repo-wide, and a missing workspace manifest makes bun
# consider the lockfile changed, which --frozen-lockfile then rejects.
COPY package.json bun.lock ./
COPY packages/bot/package.json packages/bot/
COPY packages/shared/package.json packages/shared/
COPY packages/agents/package.json packages/agents/

# The root manifest declares `patchedDependencies`, so bun resolves the patch
# file even for a --filter that excludes the package it patches. Copying the
# directory is cheaper than teaching the image which patches it can skip.
COPY patches/ patches/

# --filter keeps the agent's dependency tree (eve, the AI SDK) out of the bot
# image, which would otherwise be installed just by being in the workspace.
# --frozen-lockfile fails the build when the lockfile and manifests disagree,
# rather than silently resolving something the repo never tested.
RUN bun install --frozen-lockfile --production --filter='@repo/bot' --filter='@repo/shared'

# Drop the TypeScript compiler from the runtime tree.
#
# It is not a dependency of anything here — it arrives as a *types-only* peer of
# `@purduehackers/discord-markdown-utils` and `@t3-oss/env-core`, and bun
# installs peers. Nothing loads it at runtime, but its platform package ships a
# ~30MB Go binary whose vendored `golang.org/x/text` and Go stdlib carry their
# own CVEs, which failed the image vulnerability gate on a compiler the bot
# never runs. `--production` does not help: these are peers, not devDependencies.
RUN rm -rf node_modules/.bun/typescript@* node_modules/.bun/@typescript+* \
    && find . -path '*/node_modules/typescript' -prune -exec rm -rf {} + \
    && find . -path '*/node_modules/@typescript' -prune -exec rm -rf {} +


FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime

WORKDIR /app

# The pinned base still ships openssl 3.5.6-r0, which carries a HIGH CVE with a
# published fix (3.5.7-r0). Upgrading just these two keeps the digest pin
# meaningful while clearing the gate; a base bump replaces this when upstream
# rebuilds.
RUN apk --no-cache upgrade libcrypto3 libssl3

ENV NODE_ENV=production \
    OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT=65536
ENV PORT=8080

# Bun workspaces put each member's dependencies under that member, with the
# shared store hoisted to the root, so all three trees are needed. The
# `@repo/shared` entry inside the bot's tree is a relative symlink to
# ../../shared, which resolves because the source is copied below.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/bot/node_modules ./packages/bot/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json bun.lock ./
COPY packages/shared ./packages/shared
COPY packages/bot ./packages/bot

# Unprivileged. The base image ships a `bun` user; nothing here needs root.
USER bun

EXPOSE 8080

# Reports unhealthy until the gateway is actually connected. A probe that only
# proved the process existed would never restart a bot whose socket had dropped.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun --eval "const r = await fetch('http://127.0.0.1:' + (process.env.PORT ?? 8080) + '/health'); process.exit(r.ok ? 0 : 1)"

WORKDIR /app/packages/bot

# `bun run start`, not the flags spelled out: `bun --preload X run Y` is not a
# valid invocation — bun prints its help and exits 1 — and this spelled them out
# in the wrong order. Deferring to the package script keeps one definition of how
# the bot starts, which is also what the agent's supervisor now invokes.
CMD ["bun", "run", "start"]
