FROM node:24-slim AS base
RUN npm install -g pnpm@12.4.2
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY cloud/server/package.json cloud/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter "@talksume/cloud-server..."

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src
COPY cloud/server/src cloud/server/src
USER node
EXPOSE 8080
CMD ["node", "cloud/server/src/main.ts"]
