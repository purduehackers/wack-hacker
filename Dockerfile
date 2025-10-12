FROM docker.io/oven/bun:1-alpine AS builder

RUN apk add python3 build-base

WORKDIR /app

COPY bun.lockb .
COPY package.json .

RUN bun install --frozen-lockfile

COPY src ./src

RUN bun build --compile --sourcemap --outfile bot ./src/index.ts

FROM docker.io/alpine:3

# For some reason, Bun single-file executables targeting musl require libstdc++
RUN apk --no-cache add libstdc++

WORKDIR /app

COPY --from=builder /app/bot /app/bot

ENV TZ=America/Indiana/Indianapolis

ENTRYPOINT ["/app/bot"]
