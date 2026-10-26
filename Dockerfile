# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app

# Full dependency set: used to build, lint and test.
FROM base AS dev
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

FROM dev AS build
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
