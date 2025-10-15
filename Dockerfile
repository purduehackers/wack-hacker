FROM oven/bun AS build

WORKDIR /app

COPY bun.lockb .
COPY package.json .

RUN bun pm cache clean
RUN bun install --frozen-lockfile

COPY src ./src

RUN bun build ./src/index.ts --compile --outfile bot

FROM ubuntu:22.04

WORKDIR /app

COPY --from=build /app/bot /app/bot

ENV TZ=America/Indiana/Indianapolis

CMD ["/app/bot"]
