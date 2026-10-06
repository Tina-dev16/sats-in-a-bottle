FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && mkdir /data && chown app:app /data
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/server ./server
COPY --from=build --chown=app:app /app/web/dist ./web/dist
COPY --chown=app:app package.json ./
USER app
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3001
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "--no-warnings", "server/index.js"]
