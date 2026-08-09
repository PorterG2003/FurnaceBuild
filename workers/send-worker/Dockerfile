# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy and build @furnace/email-lib first (worker depends on file:../../lib/email)
RUN mkdir -p /app/lib/email /app/lib/mailbox /app/lib/slack /app/lib/campaign /app/workers/send-worker
COPY lib/email/package*.json lib/email/tsconfig.build.json ./lib/email/
COPY lib/email/*.ts ./lib/email/
COPY lib/email/threading ./lib/email/threading
WORKDIR /app/lib/email
RUN npm install && npm run build

# Copy and build @furnace/mailbox-lib (worker depends on file:../../lib/mailbox)
WORKDIR /app
COPY lib/mailbox/package*.json lib/mailbox/tsconfig.build.json lib/mailbox/*.ts ./lib/mailbox/
WORKDIR /app/lib/mailbox
RUN npm install && npm run build

# Copy and build @furnace/slack-lib (worker depends on file:../../lib/slack)
WORKDIR /app
COPY lib/slack/package.json lib/slack/package-lock.json lib/slack/tsconfig.build.json lib/slack/*.ts ./lib/slack/
WORKDIR /app/lib/slack
RUN npm install && npm run build

# Copy @furnace/campaign-lib (worker depends on file:../../lib/campaign)
WORKDIR /app
COPY lib/campaign/package.json ./lib/campaign/
COPY lib/campaign/*.js ./lib/campaign/
COPY lib/campaign/*.d.ts ./lib/campaign/
WORKDIR /app/lib/campaign
RUN npm install

# Copy and build @furnace/webhooks-lib (worker depends on file:../../lib/webhooks)
WORKDIR /app
COPY lib/webhooks/package*.json lib/webhooks/tsconfig.build.json lib/webhooks/*.ts ./lib/webhooks/
WORKDIR /app/lib/webhooks
RUN npm install && npm run build

# Worker: copy package files and install (file:../../lib/* resolve)
WORKDIR /app/workers/send-worker
COPY workers/send-worker/package*.json ./
RUN npm ci

# Copy worker source and build
COPY workers/send-worker/src ./src
COPY workers/send-worker/tsconfig.json ./
RUN npm run build

# Production stage (keep same layout as builder so file:../../lib/* resolves)
FROM node:20-alpine

WORKDIR /app

# Copy shared libs so file:../../lib/* from worker dir resolve
COPY --from=builder /app/lib/mailbox/package.json ./lib/mailbox/
COPY --from=builder /app/lib/mailbox/dist ./lib/mailbox/dist
COPY --from=builder /app/lib/email/package.json ./lib/email/
COPY --from=builder /app/lib/email/dist ./lib/email/dist
COPY --from=builder /app/lib/email/node_modules ./lib/email/node_modules
COPY --from=builder /app/lib/slack/package.json ./lib/slack/
COPY --from=builder /app/lib/slack/dist ./lib/slack/dist
COPY --from=builder /app/lib/campaign/package.json ./lib/campaign/
COPY --from=builder /app/lib/campaign/schedule.js ./lib/campaign/
COPY --from=builder /app/lib/campaign/schedule.d.ts ./lib/campaign/
COPY --from=builder /app/lib/campaign/mailbox-send-time.js ./lib/campaign/
COPY --from=builder /app/lib/campaign/mailbox-send-time.d.ts ./lib/campaign/
COPY --from=builder /app/lib/campaign/node_modules ./lib/campaign/node_modules
COPY --from=builder /app/lib/webhooks/package.json ./lib/webhooks/
COPY --from=builder /app/lib/webhooks/dist ./lib/webhooks/dist

# Copy worker package and built output into workers/send-worker
COPY workers/send-worker/package*.json ./workers/send-worker/
COPY --from=builder /app/workers/send-worker/dist ./workers/send-worker/dist

WORKDIR /app/workers/send-worker
RUN npm ci --production && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

WORKDIR /app/workers/send-worker
CMD ["node", "dist/index.js"]
