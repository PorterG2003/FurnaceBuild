# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy and build @furnace/slack-lib (worker depends on file:../../lib/slack)
RUN mkdir -p /app/lib/slack /app/lib/campaign /app/workers/scheduler-worker
COPY lib/slack/package*.json lib/slack/tsconfig.build.json ./lib/slack/
COPY lib/slack/*.ts ./lib/slack/
WORKDIR /app/lib/slack
RUN npm install && npm run build

# Copy @furnace/campaign-lib (worker depends on file:../../lib/campaign)
WORKDIR /app
COPY lib/campaign/package.json ./lib/campaign/
COPY lib/campaign/*.js ./lib/campaign/
COPY lib/campaign/*.d.ts ./lib/campaign/
WORKDIR /app/lib/campaign
RUN npm install

# Worker: package files and install (file:../../lib/* resolve)
WORKDIR /app
COPY workers/scheduler-worker/package*.json ./workers/scheduler-worker/
WORKDIR /app/workers/scheduler-worker
RUN npm ci

# Copy worker source code and build
COPY workers/scheduler-worker/src ./src
COPY workers/scheduler-worker/tsconfig.json ./
RUN npm run build

# Production stage (path layout so file:../../lib/* resolve)
FROM node:20-alpine

WORKDIR /app

# Copy shared libs so file:../../lib/* from worker dir resolve
COPY --from=builder /app/lib/slack/package.json ./lib/slack/
COPY --from=builder /app/lib/slack/dist ./lib/slack/dist
COPY --from=builder /app/lib/campaign/package.json ./lib/campaign/
COPY --from=builder /app/lib/campaign/schedule.js ./lib/campaign/
COPY --from=builder /app/lib/campaign/schedule.d.ts ./lib/campaign/
COPY --from=builder /app/lib/campaign/mailbox-send-time.js ./lib/campaign/
COPY --from=builder /app/lib/campaign/mailbox-send-time.d.ts ./lib/campaign/
COPY --from=builder /app/lib/campaign/node_modules ./lib/campaign/node_modules

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
