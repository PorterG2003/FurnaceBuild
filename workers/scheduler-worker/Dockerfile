# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for worker
COPY workers/scheduler-worker/package*.json ./workers/scheduler-worker/
WORKDIR /app/workers/scheduler-worker

# Install dependencies
RUN npm ci

# Copy worker source code
COPY workers/scheduler-worker/src ./src
COPY workers/scheduler-worker/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY workers/scheduler-worker/package*.json ./

# Copy built dist folder from builder stage (not from host)
COPY --from=builder /app/workers/scheduler-worker/dist ./dist

# Install production dependencies only
RUN npm ci --production && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Start worker
CMD ["node", "dist/index.js"]

