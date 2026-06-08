# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy and build @furnace/email-lib first (worker depends on file:../../lib/email)
COPY lib/email/package*.json lib/email/tsconfig.build.json ./lib/email/
COPY lib/email/*.ts ./lib/email/
WORKDIR /app/lib/email
RUN npm install && npm run build

# Copy and build @furnace/mailbox-lib (worker depends on file:../../lib/mailbox)
WORKDIR /app
COPY lib/mailbox/package*.json lib/mailbox/tsconfig.build.json lib/mailbox/*.ts ./lib/mailbox/
WORKDIR /app/lib/mailbox
RUN npm install && npm run build

# Copy and build @furnace/slack-lib (worker depends on file:../../lib/slack)
WORKDIR /app
COPY lib/slack/package*.json lib/slack/tsconfig.build.json ./lib/slack/
COPY lib/slack/*.ts ./lib/slack/
WORKDIR /app/lib/slack
RUN npm install && npm run build

# Worker: copy package files and install (file:../../lib/email and file:../../lib/slack resolve)
WORKDIR /app/workers/send-worker
COPY workers/send-worker/package*.json ./
RUN npm ci

# Copy worker source and build
COPY workers/send-worker/src ./src
COPY workers/send-worker/tsconfig.json ./
RUN npm run build

# Production stage (keep same layout as builder so file:../../lib/email resolves)
FROM node:20-alpine

WORKDIR /app

# Copy email-lib and slack-lib (package.json + dist only) so file:../../lib/* from worker dir resolve
COPY --from=builder /app/lib/mailbox/package.json ./lib/mailbox/
COPY --from=builder /app/lib/mailbox/dist ./lib/mailbox/dist
COPY --from=builder /app/lib/email/package.json ./lib/email/
COPY --from=builder /app/lib/email/dist ./lib/email/dist
COPY --from=builder /app/lib/slack/package.json ./lib/slack/
COPY --from=builder /app/lib/slack/dist ./lib/slack/dist

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
