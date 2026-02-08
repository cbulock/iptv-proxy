#!/bin/sh
set -e

# Ensure config and data directories exist
mkdir -p "${CONFIG_PATH:-/config}"
mkdir -p "${DATA_PATH:-/data}"

# If running as root, ensure directories are writable
if [ "$(id -u)" = "0" ]; then
  # If a specific UID is provided, create the user and set ownership
  if [ -n "$USER_ID" ]; then
    GROUP_ID="${GROUP_ID:-$USER_ID}"
    
    # Create group if it doesn't exist
    if ! getent group "$GROUP_ID" > /dev/null 2>&1; then
      addgroup -g "$GROUP_ID" appgroup 2>/dev/null || true
    fi
    
    # Create user if it doesn't exist
    if ! getent passwd "$USER_ID" > /dev/null 2>&1; then
      adduser -u "$USER_ID" -G "$(getent group "$GROUP_ID" | cut -d: -f1)" -S -H -s /sbin/nologin appuser 2>/dev/null || true
    fi
    
    # Set ownership of directories
    chown -R "$USER_ID:$GROUP_ID" "${CONFIG_PATH:-/config}" 2>/dev/null || true
    chown -R "$USER_ID:$GROUP_ID" "${DATA_PATH:-/data}" 2>/dev/null || true
    chmod 755 "${CONFIG_PATH:-/config}"
    chmod 755 "${DATA_PATH:-/data}"
    
    # Run as the specified user
    exec su-exec "$USER_ID" node index.js
  else
    # No specific user, just ensure directories are readable/writable
    chmod 755 "${CONFIG_PATH:-/config}"
    chmod 755 "${DATA_PATH:-/data}"
    exec node index.js
  fi
else
  # Not running as root, just run the app
  exec node index.js
fi
