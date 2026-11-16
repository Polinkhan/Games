# One image: Fastify serves the built web client and the Socket.IO server on one port.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @tash/web build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/apps/web/dist
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @tash/server... && pnpm store prune
COPY packages/engine packages/engine
COPY apps/server apps/server
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
