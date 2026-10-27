#!/bin/sh
# Docker healthcheck script
# Checks if the HTTP server is responding on the health endpoint

set -e

# Make HTTP request to health endpoint
wget --quiet --tries=1 --spider http://localhost:34400/health || exit 1
