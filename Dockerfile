# Mandate: one image, API + built web app. Secrets come from the runtime environment, never the image.
FROM node:24.15.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.15.0-alpine
ENV NODE_ENV=production HOST=0.0.0.0 API_PORT=8080 WEB_DIST=/app/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/dist/main.js"]
