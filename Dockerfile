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

# Copy application files
COPY package*.json ./
COPY index.js ./
COPY libs ./libs
COPY scripts ./scripts
COPY server ./server
COPY public ./public

# Copy healthcheck
COPY healthcheck.sh ./
RUN chmod +x /usr/src/app/healthcheck.sh

# Create mounted volume directories with world-writable permissions
RUN mkdir -p /config /data && \
    chmod 777 /config /data

# Set config and data directory paths
ENV CONFIG_PATH=/config
ENV DATA_PATH=/data

VOLUME ["/config", "/data"]

# Expose application port
EXPOSE 34400

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD /bin/sh /usr/src/app/healthcheck.sh

# Run the application
CMD ["node", "index.js"]
