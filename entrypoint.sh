#!/bin/sh
# Ensure directories exist with proper permissions
mkdir -p "${CONFIG_PATH:-/config}" "${DATA_PATH:-/data}"
chmod 777 "${CONFIG_PATH:-/config}" "${DATA_PATH:-/data}"

# Run node
exec node index.js
