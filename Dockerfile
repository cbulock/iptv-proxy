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

# Copy healthcheck and entrypoint
COPY healthcheck.sh ./
COPY entrypoint.sh ./
RUN chmod +x /usr/src/app/entrypoint.sh /usr/src/app/healthcheck.sh

# Create mounted volume directories (permissions will be handled at runtime)
RUN mkdir -p /config /data

# Install su-exec for privilege dropping and other utilities
RUN apk add --no-cache su-exec

# Set config and data directory paths
ENV CONFIG_PATH=/config
ENV DATA_PATH=/data

VOLUME ["/config", "/data"]

# Expose application port
EXPOSE 34400

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD /bin/sh /usr/src/app/healthcheck.sh

# Use entrypoint script to handle permissions and optional user switching
ENTRYPOINT ["/usr/src/app/entrypoint.sh"]
