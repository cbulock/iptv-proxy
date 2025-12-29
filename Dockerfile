# Stage 1: Build admin UI
FROM node:20-alpine AS admin-builder

WORKDIR /build/admin

# Copy admin package files
COPY admin/package*.json ./

# Install admin dependencies
RUN npm ci

# Copy admin source
COPY admin/ ./

# Build admin UI
RUN npm run build

# Stage 2: Build production dependencies
FROM node:20-alpine AS deps

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Stage 3: Final production image
FROM node:20-alpine

# Add metadata labels
LABEL org.opencontainers.image.source="https://github.com/cbulock/iptv-proxy"
LABEL org.opencontainers.image.description="IPTV Proxy - Unified Channel and EPG Aggregator"
LABEL org.opencontainers.image.licenses="MIT"

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory
WORKDIR /usr/src/app

# Copy production dependencies
COPY --from=deps /build/node_modules ./node_modules

# Copy built admin UI
COPY --from=admin-builder /build/admin/dist ./public/admin

# Copy application source
COPY package*.json ./
COPY index.js ./
COPY libs ./libs
COPY scripts ./scripts
COPY server ./server
COPY public ./public

# Create non-root user for security
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

# Make /config the single mount point for all configs
RUN mkdir -p /config && \
    chown -R appuser:appuser /usr/src/app /config

# Switch to non-root user
USER appuser

VOLUME ["/config"]

# Expose application port
EXPOSE 34400

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:34400/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run the server
CMD ["node", "index.js"]
