FROM node:24-slim AS base
RUN npm install -g pnpm@12.4.2
WORKDIR /app

FROM base AS manifests
COPY . /src
RUN cd /src && find . -name package.json -not -path "*/node_modules/*" -exec cp --parents {} /app \; \
  && cp pnpm-lock.yaml pnpm-workspace.yaml /app/

FROM base AS deps
COPY --from=manifests /app ./
RUN pnpm install --frozen-lockfile --prod --filter "@talksume/cloud-server..."

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY packages packages
COPY cloud cloud
USER node
EXPOSE 8080
CMD ["node", "cloud/server/src/main.ts"]
