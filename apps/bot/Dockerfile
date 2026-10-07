FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/
RUN pnpm install --filter @ya-ryadom/bot
COPY apps/bot apps/bot
WORKDIR /app/apps/bot
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
