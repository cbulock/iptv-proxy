#!/bin/sh
set -e

# Ensure config and data directories exist and are writable
mkdir -p "${CONFIG_PATH:-/config}"
mkdir -p "${DATA_PATH:-/data}"

# If running as root, ensure directories are writable by any process
if [ "$(id -u)" = "0" ]; then
  chmod 755 "${CONFIG_PATH:-/config}"
  chmod 755 "${DATA_PATH:-/data}"
fi

# If a specific UID is provided, create/use that user
if [ -n "$USER_ID" ]; then
  if ! id "$USER_ID" >/dev/null 2>&1; then
    addgroup -g "$GROUP_ID" appuser 2>/dev/null || true
    adduser -u "$USER_ID" -G appuser -S -H appuser 2>/dev/null || true
  fi
  
  # Ensure directories are owned by the user
  chown -R "$USER_ID:${GROUP_ID:-$USER_ID}" "${CONFIG_PATH:-/config}" 2>/dev/null || true
  chown -R "$USER_ID:${GROUP_ID:-$USER_ID}" "${DATA_PATH:-/data}" 2>/dev/null || true
  
  # Run as the specified user
  exec su-exec "$USER_ID" node index.js
else
  # Run as root (default)
  exec node index.js
fi
