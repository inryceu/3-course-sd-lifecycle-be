# =============================================================================
# BoardSync Backend - Multi-stage Dockerfile
# =============================================================================
# Stage 1: Base image with pnpm and dependencies
# Stage 2: Development (with hot reload support)
# Stage 3: Builder (compile TypeScript)
# Stage 4: Production runner (minimal, non-root)
# =============================================================================

# -----------------------------------------------------------------------------
# BASE STAGE - Shared dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Set working directory
WORKDIR /app

# Install system dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml* ./

# -----------------------------------------------------------------------------
# DEPS STAGE - Install all dependencies (including devDependencies)
# -----------------------------------------------------------------------------
FROM base AS deps

# Install ALL dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile --prod=false

# -----------------------------------------------------------------------------
# BUILDER STAGE - Compile TypeScript
# -----------------------------------------------------------------------------
FROM deps AS builder

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# -----------------------------------------------------------------------------
# DEVELOPMENT STAGE - Hot reload with bind mounts
# -----------------------------------------------------------------------------
FROM deps AS development

# Copy source code (will be overridden by bind mount in docker-compose)
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# Change ownership of app directory
RUN chown -R nestjs:nodejs /app
USER nestjs

# Expose ports
EXPOSE 3000 3001

# Start with hot reload
CMD ["pnpm", "start:dev"]

# -----------------------------------------------------------------------------
# PRODUCTION STAGE - Minimal runtime image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Install pnpm for potential runtime needs
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# Copy only production dependencies from builder
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Start production server
CMD ["node", "dist/main.js"]