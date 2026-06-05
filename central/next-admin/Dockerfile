FROM node:20-slim AS base

# Stage 1: install deps
FROM base AS deps
WORKDIR /code
COPY package.json ./
RUN npm install -g pnpm
RUN pnpm install --no-frozen-lockfile

# Stage 2: build
# NEXT_PUBLIC_* are inlined into the client bundle at `pnpm build` time —
# runtime env vars cannot fix a build that ran without them. Pass via
# docker-compose build args (see docker-compose.yml: next-admin.build.args).
FROM base AS builder
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_ADMIN_API_BASE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_ADMIN_API_BASE=$NEXT_PUBLIC_ADMIN_API_BASE
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
# PORT is read by the standalone server.js — without it, Next defaults to
# 3000 and nginx (which targets 3001) returns 502.
FROM base AS runner
WORKDIR /code
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=builder /code/public ./public
COPY --from=builder /code/.next/standalone ./
COPY --from=builder /code/.next/static ./.next/static
EXPOSE 3001
CMD ["node", "server.js"]
