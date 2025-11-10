# Use a lightweight Node.js base image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build Admin UI (Vite) and prune dev deps
WORKDIR /usr/src/app/admin
RUN npm install && npm run build
WORKDIR /usr/src/app
RUN npm prune --production

# Make /config the single mount point for all configs,
# but preserve defaults if present
RUN mkdir -p /config \
    && if [ -d ./config ]; then cp -a ./config/. /config/; fi \
    && rm -rf ./config \
    && ln -s /config ./config

VOLUME ["/config"]

# Expose application port
EXPOSE 34400

# Run the server
CMD ["npm", "run", "serve"]
