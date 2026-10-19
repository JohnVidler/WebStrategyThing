FROM node:24-bookworm-slim AS client-build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/server/package.json packages/server/package.json
RUN npm ci

COPY . .
ARG VITE_SERVER_URL
RUN if [ -n "$VITE_SERVER_URL" ]; then \
      npm run build --workspace=@wst/client; \
    else \
      unset VITE_SERVER_URL && npm run build --workspace=@wst/client; \
    fi

FROM nginx:alpine AS client
COPY --from=client-build /app/packages/client/dist/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

FROM node:24-bookworm-slim AS server-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/server/package.json packages/server/package.json
RUN npm ci --omit=dev --workspace=@wst/engine --workspace=@wst/server

FROM node:24-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY packages/engine/src ./packages/engine/src
COPY packages/server/package.json ./packages/server/package.json
COPY packages/server/src ./packages/server/src
# Sound effects and their manifest ship with the image (SOUND_DIR overrides).
COPY sound ./sound

USER node
EXPOSE 8080
CMD ["npm", "run", "start", "--workspace=@wst/server"]