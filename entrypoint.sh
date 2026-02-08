#!/bin/sh
set -e

# Ensure config and data directories exist
mkdir -p "${CONFIG_PATH:-/config}"
mkdir -p "${DATA_PATH:-/data}"

# Ensure directories are writable
chmod 755 "${CONFIG_PATH:-/config}" 2>/dev/null || true
chmod 755 "${DATA_PATH:-/data}" 2>/dev/null || true

# If running as root with a specific USER_ID, switch to that user
if [ "$(id -u)" = "0" ] && [ -n "$USER_ID" ]; then
  GROUP_ID="${GROUP_ID:-$USER_ID}"
  
  # Create group if needed
  getent group "$GROUP_ID" > /dev/null || addgroup -g "$GROUP_ID" appgroup
  
  # Create user if needed  
  getent passwd "$USER_ID" > /dev/null || adduser -u "$USER_ID" -G appgroup -S -H -s /sbin/nologin appuser
  
  # Set ownership
  chown -R "$USER_ID:$GROUP_ID" "${CONFIG_PATH:-/config}" 2>/dev/null || true
  chown -R "$USER_ID:$GROUP_ID" "${DATA_PATH:-/data}" 2>/dev/null || true
  
  # Run as that user
  exec su-exec "$USER_ID" node index.js
else
  # Run as current user (root by default)
  exec node index.js
fi
