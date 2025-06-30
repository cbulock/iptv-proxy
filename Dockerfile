# Use a lightweight Node.js base image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Make /config the single mount point for all configs,
# but preserve defaults on build
RUN mkdir -p /config \
    && cp -a ./config/. /config/ \
    && rm -rf ./config \
    && ln -s /config ./config

VOLUME ["/config"]

# Expose application port
EXPOSE 34400

# Run the server
CMD ["npm", "run", "serve"]
