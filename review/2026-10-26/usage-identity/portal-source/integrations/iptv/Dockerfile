FROM node:24-alpine
WORKDIR /app
COPY gateway.mjs ./gateway.mjs
COPY health.mjs ./health.mjs
COPY live-tv.mjs ./live-tv.mjs
USER node
EXPOSE 3400
CMD ["node", "gateway.mjs"]
