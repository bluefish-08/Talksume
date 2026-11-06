FROM node:24-slim AS build
RUN npm install -g pnpm@12.4.2
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@talksume/cloud-web..." && pnpm --filter @talksume/cloud-web build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/cloud/web/dist /usr/share/nginx/html
