#!/bin/sh
set -e

echo "Starting entrypoint..."
echo "Fixing config directory permissions..."

# Fix permissions on bind mount
chmod -R 777 /config 2>&1 || echo "chmod failed"
chown -R root:root /config 2>&1 || echo "chown failed"

echo "Permissions fixed, starting Node app..."

# Start the application
node index.js
