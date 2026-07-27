FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY migrations ./migrations
COPY config ./config
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile=false
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY config ./config
CMD ["node", "dist/index.js"]
