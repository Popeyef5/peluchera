FROM node:20-slim AS base

# Stage 1: Install dependencies
FROM base AS deps
WORKDIR /code
COPY package.json pnpm-lock.yaml ./
# pnpm is pinned: an unpinned `npm install -g pnpm` picked up pnpm 12, which
# fails the install on skipped dependency build scripts (sharp, core-js).
RUN npm install -g pnpm@10.34.5
RUN pnpm install --frozen-lockfile

# Stage 2: Build the application
FROM base AS builder
RUN npm install -g pnpm@10.34.5
WORKDIR /code
COPY . .
COPY --from=deps /code/node_modules ./node_modules
# `next build` on this app (wagmi + three.js + Next 15) exceeds V8's default
# heap ceiling (~1 GB) and aborts with "JavaScript heap out of memory". Raise
# the old-space limit. The box needs RAM+swap to back this — see DEPLOY.md.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm build

# Dev stage: hot-reload server. Used by docker-compose.dev.yml via `target: dev`.
FROM base AS dev
RUN npm install -g pnpm@10.34.5
WORKDIR /code
COPY --from=deps /code/node_modules ./node_modules
EXPOSE 3000
CMD ["pnpm", "dev"]

# Stage 3: Production server
FROM base AS runner
# RUN npm install -g pnpm@10.34.5
WORKDIR /code
ENV NODE_ENV=production

# bring in the prod deps so `next` exists
# COPY --from=deps /code/node_modules ./node_modules
# COPY package.json pnpm-lock.yaml ./

COPY --from=builder /code/public ./public
COPY --from=builder /code/.next/standalone ./
COPY --from=builder /code/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]