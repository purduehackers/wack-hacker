FROM oven/bun:1.3.0-alpine

WORKDIR /app

COPY bun.lock .
COPY package.json .

RUN bun install --frozen-lockfile

COPY src ./src

ENV TZ=America/Indiana/Indianapolis

CMD ["bun", "run", "src/index.ts"]
