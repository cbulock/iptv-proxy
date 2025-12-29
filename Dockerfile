# Stage 1: Build production dependencies
FROM node:20-alpine AS deps

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Stage 2: Final production image
FROM node:20-alpine

# Add metadata labels
LABEL org.opencontainers.image.source="https://github.com/cbulock/iptv-proxy"
LABEL org.opencontainers.image.description="IPTV Proxy - Unified Channel and EPG Aggregator"
LABEL org.opencontainers.image.licenses="MIT"

# Create app directory
WORKDIR /usr/src/app

# Copy production dependencies
COPY --from=deps /build/node_modules ./node_modules

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

# Run the server
CMD ["node", "index.js"]
