FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/
COPY apps/bot/tsconfig.json apps/bot/

RUN pnpm install --filter @ya-ryadom/bot...

COPY apps/bot/src apps/bot/src

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["pnpm", "--filter", "@ya-ryadom/bot", "start"]
