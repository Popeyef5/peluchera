FROM node:20-slim AS base

# Stage 1: install deps
FROM base AS deps
WORKDIR /code
COPY package.json ./
RUN npm install -g pnpm
RUN pnpm install --no-frozen-lockfile

# Stage 2: build
FROM base AS builder
RUN npm install -g pnpm
WORKDIR /code
COPY . .
COPY --from=deps /code/node_modules ./node_modules
RUN pnpm build

# Dev: hot-reload on port 3001 (different from central/next's 3000 to avoid
# collisions if both run on the same Docker host network).
FROM base AS dev
RUN npm install -g pnpm
WORKDIR /code
COPY --from=deps /code/node_modules ./node_modules
EXPOSE 3001
CMD ["pnpm", "dev"]

# Prod: standalone server bundle, same shape as central/next.
FROM base AS runner
WORKDIR /code
ENV NODE_ENV=production
COPY --from=builder /code/public ./public
COPY --from=builder /code/.next/standalone ./
COPY --from=builder /code/.next/static ./.next/static
EXPOSE 3001
CMD ["node", "server.js"]
