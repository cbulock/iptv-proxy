# Use a lightweight Node.js base image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose application port
EXPOSE 34400

# Run the server
CMD ["npm", "run", "serve"]
