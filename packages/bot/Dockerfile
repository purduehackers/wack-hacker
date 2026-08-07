# The bot: one always-on Bun process holding a Discord gateway connection.
#
# Host-agnostic on purpose. This image runs unchanged on Vercel Sandbox, Fly,
# Railway, or a homelab box — the bot has no Vercel imports, and its /health
# endpoint serves a container HEALTHCHECK, a platform liveness probe, and the
# Vercel Sandbox supervisor equally. Choosing a host is a deploy decision, not a
# code decision.
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
# the supervisor starts the process with runCommand. CMD below is what every
# other host uses, and it documents the intended entry either way.

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS deps

WORKDIR /app

# Manifests first, so a source-only change reuses the install layer.
#
# Every workspace manifest is copied even though agents/supervisor are not part
# of this image: the
# lockfile is repo-wide, and a missing workspace manifest makes bun consider the
# lockfile changed, which --frozen-lockfile then rejects.
COPY package.json bun.lock ./
COPY packages/bot/package.json packages/bot/
COPY packages/shared/package.json packages/shared/
COPY packages/agents/package.json packages/agents/
COPY packages/supervisor/package.json packages/supervisor/

# --filter keeps the agent's dependency tree (eve, the AI SDK) out of the bot
# image, which would otherwise be installed just by being in the workspace.
# --frozen-lockfile fails the build when the lockfile and manifests disagree,
# rather than silently resolving something the repo never tested.
RUN bun install --frozen-lockfile --production --filter='@repo/bot' --filter='@repo/shared'


FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT=65536
ENV PORT=8080
ENV TZ=America/Indiana/Indianapolis

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

CMD ["bun", "--preload", "src/instrument.ts", "run", "src/index.ts"]
