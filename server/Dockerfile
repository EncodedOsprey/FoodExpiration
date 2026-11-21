# Pantry Pal push server. Build from the repository root (the server shares app/js/alerts.js):
#   docker build -f server/Dockerfile -t pantry-pal-push .
#   docker run -d -p 8787:8787 -v pantry-pal-data:/data \
#     -e PUSH_TOKEN=change-me -e ALLOWED_ORIGINS=https://you.github.io pantry-pal-push
FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/server.js ./
COPY server/lib ./lib
COPY app /srv/app
RUN echo '{"type":"module"}' > /srv/package.json && mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=1m --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server.js"]
