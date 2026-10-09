FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/
COPY apps/bot/tsconfig.json apps/bot/

RUN pnpm install --filter @ya-ryadom/bot... --frozen-lockfile=false

COPY apps/bot/src apps/bot/src

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["pnpm", "--filter", "@ya-ryadom/bot", "start"]
