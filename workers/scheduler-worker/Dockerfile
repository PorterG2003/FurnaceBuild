# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy and build @furnace/slack-lib (worker depends on file:../../lib/slack)
COPY lib/slack/package*.json lib/slack/tsconfig.build.json ./lib/slack/
COPY lib/slack/*.ts ./lib/slack/
WORKDIR /app/lib/slack
RUN npm install && npm run build

# Worker: package files and install (file:../../lib/slack resolves to /app/lib/slack)
WORKDIR /app
COPY workers/scheduler-worker/package*.json ./workers/scheduler-worker/
WORKDIR /app/workers/scheduler-worker
RUN npm ci

# Copy worker source code and build
COPY workers/scheduler-worker/src ./src
COPY workers/scheduler-worker/tsconfig.json ./
RUN npm run build

# Production stage (path layout so file:../../lib/slack resolves)
FROM node:20-alpine

WORKDIR /app

# Copy slack-lib so file:../../lib/slack from worker dir resolves
COPY --from=builder /app/lib/slack/package.json ./lib/slack/
COPY --from=builder /app/lib/slack/dist ./lib/slack/dist

# Copy worker package and built output
COPY workers/scheduler-worker/package*.json ./workers/scheduler-worker/
COPY --from=builder /app/workers/scheduler-worker/dist ./workers/scheduler-worker/dist

WORKDIR /app/workers/scheduler-worker
RUN npm ci --production && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Start worker
CMD ["node", "dist/index.js"]

