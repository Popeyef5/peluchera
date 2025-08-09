FROM node:20-slim AS base

# Stage 1: Install dependencies
FROM base AS deps
WORKDIR /code
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Stage 2: Build the application
FROM base AS builder
RUN npm install -g pnpm
WORKDIR /code
COPY . .
COPY --from=deps /code/node_modules ./node_modules
RUN pnpm build

# Stage 3: Production server
FROM base AS runner
# RUN npm install -g pnpm
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